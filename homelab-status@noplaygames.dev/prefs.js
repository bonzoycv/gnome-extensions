// Ventana de preferencias de Homelab Status.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HomelabStatusPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'network-server-symbolic'});
        window.add(page);

        const entry = (key, title) => {
            const row = new Adw.EntryRow({title});
            settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };
        const toggle = (key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        const server = new Adw.PreferencesGroup({
            title: 'Servidor',
            description: 'Se conecta por SSH con tu llave (sin contraseña) y corre el comando de chequeo.',
        });
        page.add(server);
        server.add(entry('ssh-host', 'Host SSH (alias de ~/.ssh/config o usuario@servidor)'));
        server.add(entry('remote-command', 'Comando remoto'));

        const refresh = new Adw.SpinRow({
            title: 'Actualizar cada (minutos)',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1, page_increment: 5}),
        });
        settings.bind('refresh-minutes', refresh, 'value', Gio.SettingsBindFlags.DEFAULT);
        server.add(refresh);

        const alerts = new Adw.PreferencesGroup({title: 'Notificaciones'});
        page.add(alerts);
        alerts.add(toggle('notify', 'Avisar de problemas nuevos', 'Una notificación cuando aparece una falla o un aviso.'));
        alerts.add(toggle('notify-on-start', 'Avisar también al iniciar sesión', 'Incluye los problemas que ya estaban.'));

        const extra = new Adw.PreferencesGroup({title: 'Otros'});
        page.add(extra);
        extra.add(entry('dashboard-url', 'URL de un panel web (opcional)'));
    }
}
