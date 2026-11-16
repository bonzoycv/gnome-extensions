// Ventana de preferencias de Modo juego.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Lista de perfiles de TuneD; vacía si TuneD no está disponible.
function tunedProfiles() {
    try {
        const res = Gio.DBus.system.call_sync('com.redhat.tuned', '/Tuned', 'com.redhat.tuned.control',
            'profiles', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 3000, null);
        return res.deepUnpack()[0].sort();
    } catch {
        return [];
    }
}

export default class GameModePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'input-gaming-symbolic'});
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Perfiles de TuneD',
            description: 'El modo juego cambia al perfil de juego y, al apagarlo, vuelve al perfil normal.',
        });
        page.add(group);

        const profiles = tunedProfiles();
        const profileRow = (key, title) => {
            const current = settings.get_string(key);
            const list = profiles.includes(current) || !current ? profiles : [current, ...profiles];
            if (!list.length) {
                const row = new Adw.EntryRow({title});
                settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
                return row;
            }
            const row = new Adw.ComboRow({title, model: Gtk.StringList.new(list)});
            row.selected = Math.max(0, list.indexOf(current));
            row.connect('notify::selected', () => settings.set_string(key, list[row.selected]));
            settings.connect(`changed::${key}`, () => {
                const i = list.indexOf(settings.get_string(key));
                if (i >= 0 && i !== row.selected)
                    row.selected = i;
            });
            return row;
        };
        group.add(profileRow('game-profile', 'Perfil para jugar'));
        group.add(profileRow('normal-profile', 'Perfil normal'));

        const auto = new Adw.PreferencesGroup({title: 'GameMode'});
        page.add(auto);
        const autoRow = new Adw.SwitchRow({
            title: 'Activar automáticamente con GameMode',
            subtitle: 'Cuando un juego usa gamemoderun (o Steam con GameMode), el modo juego se enciende solo y se apaga al cerrarlo.',
        });
        settings.bind('auto-with-gamemode', autoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        auto.add(autoRow);
    }
}
