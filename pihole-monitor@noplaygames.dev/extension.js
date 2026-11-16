// Pi-hole Monitor: estadísticas de Pi-hole v6 en el panel y botones para pausar o reanudar el bloqueo.
// Usa la API REST de Pi-hole v6 (/api) con una contraseña de aplicación guardada en GSettings.
// La sesión (SID) se reutiliza mientras sea válida y se cierra al desactivar la extensión, porque
// Pi-hole admite pocas sesiones a la vez.
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

class HttpError extends Error {
    constructor(status) {
        super(`HTTP ${status}`);
        this.status = status;
    }
}

function fmtInt(n) {
    return Number(n ?? 0).toLocaleString('es');
}

function fmtTimer(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PiholeIndicator = GObject.registerClass(
class PiholeIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Pi-hole Monitor');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._sid = null;

        this._session = new Soup.Session();
        this._session.timeout = 8;

        this._panelLabel = new St.Label({
            text: '🛡️ …',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelLabel);

        this._statsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._statsSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._actionSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._actionSection);
        this._pauseItems = [[5, '5 minutos'], [30, '30 minutos'], [0, 'hasta reanudar']].map(([min, label]) => {
            const item = new PopupMenu.PopupMenuItem(`⏸️ Pausar bloqueo ${label}`);
            item.connect('activate', () => this._setBlocking(false, min * 60));
            this._actionSection.addMenuItem(item);
            return item;
        });
        this._resumeItem = new PopupMenu.PopupMenuItem('▶️ Reanudar bloqueo');
        this._resumeItem.connect('activate', () => this._setBlocking(true));
        this._actionSection.addMenuItem(this._resumeItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const web = new PopupMenu.PopupMenuItem('Abrir panel de Pi-hole');
        web.connect('activate', () => {
            const base = this._baseUrl();
            if (base)
                Gio.AppInfo.launch_default_for_uri(`${base}/admin/`, null);
        });
        this.menu.addMenuItem(web);

        const prefs = new PopupMenu.PopupMenuItem('Preferencias');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this._syncActions(null);

        this._settingsId = this._settings.connect('changed', (s, key) => {
            if (key === 'url' || key === 'app-password')
                this._logout();
            if (this._debounceId)
                GLib.source_remove(this._debounceId);
            this._debounceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._debounceId = null;
                this._restartTimer();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._restartTimer();
    }

    _baseUrl() {
        return this._settings.get_string('url').trim().replace(/\/+$/, '').replace(/\/admin$/, '');
    }

    _restartTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._update();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-seconds'),
            () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new(method, `${this._baseUrl()}/api${path}`);
            if (!message) {
                reject(new Error('URL no válida'));
                return;
            }
            if (this._sid)
                message.request_headers.append('X-FTL-SID', this._sid);
            if (body !== null) {
                message.set_request_body_from_bytes('application/json',
                    new GLib.Bytes(encoder.encode(JSON.stringify(body))));
            }
            if (this._settings.get_boolean('accept-invalid-certs'))
                message.connect('accept-certificate', () => true);

            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const status = message.status_code;
                    if (status < 200 || status >= 300) {
                        reject(new HttpError(status));
                        return;
                    }
                    const text = decoder.decode(bytes.get_data() ?? new Uint8Array());
                    resolve(text ? JSON.parse(text) : {});
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _login() {
        this._sid = null;
        const res = await this._request('POST', '/auth', {password: this._settings.get_string('app-password')});
        if (!res.session?.valid)
            throw new Error(res.session?.message || 'contraseña rechazada');
        // Sin contraseña configurada en Pi-hole, la sesión es válida pero sin SID.
        this._sid = res.session.sid ?? null;
    }

    // Hace la petición; si la sesión venció (401), inicia sesión de nuevo y reintenta una vez.
    async _api(method, path, body = null) {
        if (!this._sid && this._settings.get_string('app-password'))
            await this._login();
        try {
            return await this._request(method, path, body);
        } catch (e) {
            if (!(e instanceof HttpError) || e.status !== 401)
                throw e;
            await this._login();
            return this._request(method, path, body);
        }
    }

    _logout() {
        if (!this._sid || !this._session)
            return;
        // Sin esperar respuesta: solo libera la sesión en Pi-hole.
        this._request('DELETE', '/auth').catch(() => {});
        this._sid = null;
    }

    async _update() {
        if (!this._baseUrl()) {
            this._panelLabel.set_text('🛡️ ?');
            this._statsSection.removeAll();
            this._statsSection.addMenuItem(new PopupMenu.PopupMenuItem(
                'Falta configurar la dirección de Pi-hole (abre Preferencias).', {reactive: false}));
            this._syncActions(null);
            return;
        }
        try {
            const [summary, blocking] = await Promise.all([
                this._api('GET', '/stats/summary'),
                this._api('GET', '/dns/blocking'),
            ]);
            if (!this._session)
                return;
            this._show(summary, blocking);
        } catch (e) {
            if (!this._session)
                return;
            const msg = e instanceof HttpError && e.status === 401
                ? 'contraseña de aplicación incorrecta' : e.message;
            this._panelLabel.set_text('🛡️ ✕');
            this._statsSection.removeAll();
            this._statsSection.addMenuItem(new PopupMenu.PopupMenuItem(`No se pudo consultar: ${msg}`, {reactive: false}));
            this._syncActions(null);
            console.error(`[PiholeMonitor] ${msg}`);
        }
    }

    _show(summary, blocking) {
        const q = summary.queries ?? {};
        const enabled = blocking.blocking === 'enabled';
        const pct = Number(q.percent_blocked ?? 0);

        if (enabled)
            this._panelLabel.set_text(`🛡️ ${pct.toFixed(0)}%`);
        else
            this._panelLabel.set_text(blocking.timer ? `⏸️ ${fmtTimer(blocking.timer)}` : '⏸️ Pi-hole');

        const item = text => this._statsSection.addMenuItem(new PopupMenu.PopupMenuItem(text, {reactive: false}));
        this._statsSection.removeAll();
        if (enabled)
            item('🟢 Bloqueo activo');
        else
            item(blocking.timer ? `🟡 Bloqueo en pausa (vuelve en ${fmtTimer(blocking.timer)})` : '🔴 Bloqueo desactivado');
        item(`Consultas hoy: ${fmtInt(q.total)}`);
        item(`Bloqueadas: ${fmtInt(q.blocked)} (${pct.toFixed(1)}%)`);
        item(`Desde caché: ${fmtInt(q.cached)} · Reenviadas: ${fmtInt(q.forwarded)}`);
        item(`Clientes activos: ${fmtInt(summary.clients?.active)}`);
        item(`Dominios en las listas: ${fmtInt(summary.gravity?.domains_being_blocked)}`);

        this._syncActions(enabled);
    }

    // enabled: true, false o null (sin datos: se ocultan las acciones).
    _syncActions(enabled) {
        for (const it of this._pauseItems)
            it.visible = enabled === true;
        this._resumeItem.visible = enabled === false;
    }

    async _setBlocking(blocking, timerSeconds = 0) {
        try {
            const body = {blocking};
            if (!blocking && timerSeconds > 0)
                body.timer = timerSeconds;
            await this._api('POST', '/dns/blocking', body);
            this._update();
        } catch (e) {
            Main.notify('Pi-hole', `No se pudo cambiar el bloqueo: ${e.message}`);
        }
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        for (const id of ['_timerId', '_debounceId']) {
            if (this[id]) {
                GLib.source_remove(this[id]);
                this[id] = null;
            }
        }
        this._logout();
        this._session = null;
        super.destroy();
    }
});

export default class PiholeMonitorExtension extends Extension {
    enable() {
        this._indicator = new PiholeIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
