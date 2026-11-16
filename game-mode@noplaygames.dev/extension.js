// Modo juego: un interruptor en los ajustes rápidos que cambia el perfil de TuneD a uno de rendimiento
// y vuelve al perfil normal al apagarlo. También vigila Feral GameMode: cuando un juego lo activa
// (gamemoderun, Steam…) muestra un ícono en el panel y, si está habilitado, enciende el modo juego
// solo y lo apaga al cerrar el juego.
//
// TuneD se maneja por D-Bus (com.redhat.tuned). Su política de polkit permite cambiar de perfil a la
// sesión activa sin contraseña.
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const ICON = 'input-gaming-symbolic';

const TUNED = {
    bus: Gio.DBus.system,
    name: 'com.redhat.tuned',
    path: '/Tuned',
    iface: 'com.redhat.tuned.control',
};
const GAMEMODE = {
    name: 'com.feralinteractive.GameMode',
    path: '/com/feralinteractive/GameMode',
    iface: 'com.feralinteractive.GameMode',
};

function tunedCall(method, params = null, type = null) {
    return new Promise((resolve, reject) => {
        TUNED.bus.call(TUNED.name, TUNED.path, TUNED.iface, method, params,
            type ? new GLib.VariantType(type) : null, Gio.DBusCallFlags.NONE, 5000, null,
            (conn, res) => {
                try {
                    resolve(conn.call_finish(res).deepUnpack());
                } catch (e) {
                    reject(e);
                }
            });
    });
}

const GameModeToggle = GObject.registerClass(
class GameModeToggle extends QuickToggle {
    _init() {
        super._init({title: 'Modo juego', iconName: ICON, toggleMode: false});
    }
});

const GameModeIndicator = GObject.registerClass(
class GameModeIndicator extends SystemIndicator {
    _init(extension) {
        super._init();

        this._settings = extension.getSettings();
        this._activeProfile = null;
        this._clients = 0;
        this._autoActivated = false;
        this._busy = false;

        this._icon = this._addIndicator();
        this._icon.icon_name = ICON;
        this._icon.visible = false;

        this._toggle = new GameModeToggle();
        this._toggle.connect('clicked', () => this._onClicked());
        this.quickSettingsItems.push(this._toggle);

        // Cambios de perfil hechos desde fuera (tuned-adm, otra app).
        this._tunedSignalId = TUNED.bus.signal_subscribe(TUNED.name, TUNED.iface, 'profile_changed',
            TUNED.path, null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [profile, ok] = params.deepUnpack();
                if (ok) {
                    this._activeProfile = profile;
                    this._sync();
                }
            });
        this._refreshProfile();

        // GameMode se activa por D-Bus solo cuando un juego lo pide: se vigila el nombre del bus.
        this._gmWatchId = Gio.bus_watch_name(Gio.BusType.SESSION, GAMEMODE.name,
            Gio.BusNameWatcherFlags.NONE,
            () => this._connectGameMode(),
            () => this._disconnectGameMode());

        this._sync();
    }

    get _gameProfile() {
        return this._settings.get_string('game-profile');
    }

    async _refreshProfile() {
        try {
            [this._activeProfile] = await tunedCall('active_profile', null, '(s)');
        } catch (e) {
            this._activeProfile = null;
            console.error(`[GameMode] TuneD no responde: ${e.message}`);
        }
        this._sync();
    }

    _connectGameMode() {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            GAMEMODE.name, GAMEMODE.path, GAMEMODE.iface, null, (src, res) => {
                try {
                    this._gmProxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    console.error(`[GameMode] ${e.message}`);
                    return;
                }
                if (!this._settings) {
                    this._gmProxy = null;
                    return;
                }
                this._gmPropsId = this._gmProxy.connect('g-properties-changed', () => this._readClients());
                this._readClients();
            });
    }

    _disconnectGameMode() {
        if (this._gmProxy && this._gmPropsId)
            this._gmProxy.disconnect(this._gmPropsId);
        this._gmProxy = null;
        this._gmPropsId = null;
        this._setClients(0);
    }

    _readClients() {
        const v = this._gmProxy?.get_cached_property('ClientCount');
        this._setClients(v ? v.unpack() : 0);
    }

    _setClients(count) {
        const before = this._clients;
        this._clients = count;

        if (this._settings.get_boolean('auto-with-gamemode')) {
            if (before === 0 && count > 0 && !this._isGameProfile()) {
                this._autoActivated = true;
                this._activate();
            } else if (before > 0 && count === 0 && this._autoActivated) {
                this._autoActivated = false;
                this._deactivate();
            }
        }
        this._sync();
    }

    _isGameProfile() {
        return this._activeProfile !== null && this._activeProfile === this._gameProfile;
    }

    _onClicked() {
        this._autoActivated = false;
        if (this._isGameProfile())
            this._deactivate();
        else
            this._activate();
    }

    async _switch(profile) {
        if (this._busy)
            return;
        this._busy = true;
        this._toggle.reactive = false;
        try {
            const [[ok, msg]] = await tunedCall('switch_profile', new GLib.Variant('(s)', [profile]), '((bs))');
            if (!ok)
                throw new Error(msg);
            this._activeProfile = profile;
        } catch (e) {
            Main.notify('Modo juego', `No se pudo cambiar al perfil «${profile}»: ${e.message}`);
            await this._refreshProfile();
        } finally {
            this._busy = false;
            if (this._toggle)
                this._toggle.reactive = true;
            this._sync();
        }
    }

    _activate() {
        // Recuerda el perfil actual para volver a él al apagar.
        if (this._activeProfile && !this._isGameProfile())
            this._settings.set_string('normal-profile', this._activeProfile);
        return this._switch(this._gameProfile);
    }

    _deactivate() {
        return this._switch(this._settings.get_string('normal-profile') || 'desktop');
    }

    _sync() {
        if (!this._toggle)
            return;
        const on = this._isGameProfile();
        this._toggle.checked = on;

        let subtitle;
        if (this._activeProfile === null)
            subtitle = 'TuneD no disponible';
        else if (this._clients > 0)
            subtitle = `GameMode: ${this._clients} ${this._clients === 1 ? 'juego' : 'juegos'}`;
        else
            subtitle = this._activeProfile;
        this._toggle.subtitle = subtitle;

        this._icon.visible = on || this._clients > 0;
    }

    destroy() {
        if (this._tunedSignalId) {
            TUNED.bus.signal_unsubscribe(this._tunedSignalId);
            this._tunedSignalId = null;
        }
        if (this._gmWatchId) {
            Gio.bus_unwatch_name(this._gmWatchId);
            this._gmWatchId = null;
        }
        // Sin pasar por _setClients: desactivar la extensión (p. ej. al bloquear la pantalla) no debe
        // cambiar el perfil en medio de un juego.
        if (this._gmProxy && this._gmPropsId)
            this._gmProxy.disconnect(this._gmPropsId);
        this._gmProxy = null;
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        this._toggle = null;
        this._settings = null;
        super.destroy();
    }
});

export default class GameModeExtension extends Extension {
    enable() {
        this._indicator = new GameModeIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
