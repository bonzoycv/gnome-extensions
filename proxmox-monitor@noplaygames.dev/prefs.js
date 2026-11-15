// Ventana de preferencias de Proxmox VE Monitor.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ProxmoxMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'network-server-symbolic',
        });
        window.add(page);

        // Servidor
        const server = new Adw.PreferencesGroup({
            title: 'Servidor',
            description: 'Dónde está la API de Proxmox VE.',
        });
        page.add(server);

        const entry = (key, title) => {
            const row = new Adw.EntryRow({title});
            settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        server.add(entry('pve-host', 'Dirección (p. ej. https://192.168.1.10:8006)'));
        server.add(entry('pve-node', 'Nombre del nodo'));

        const certs = new Adw.SwitchRow({
            title: 'Aceptar certificados autofirmados',
            subtitle: 'Necesario si Proxmox usa su certificado por defecto.',
        });
        settings.bind('accept-invalid-certs', certs, 'active', Gio.SettingsBindFlags.DEFAULT);
        server.add(certs);

        // Token
        const auth = new Adw.PreferencesGroup({
            title: 'Token de la API',
            description: 'Créalo en Datacenter → Permissions → API Tokens. Basta con el rol PVEAuditor (solo lectura).',
        });
        page.add(auth);

        auth.add(entry('token-id', 'ID del token (usuario@realm!nombre)'));

        const secret = new Adw.PasswordEntryRow({title: 'Secreto del token'});
        settings.bind('token-secret', secret, 'text', Gio.SettingsBindFlags.DEFAULT);
        auth.add(secret);

        // Extras
        const extras = new Adw.PreferencesGroup({title: 'Otros'});
        page.add(extras);

        extras.add(entry('temps-url', 'URL de temperaturas (opcional, p. ej. http://192.168.1.10:9105)'));

        const refresh = new Adw.SpinRow({
            title: 'Actualizar cada (segundos)',
            adjustment: new Gtk.Adjustment({lower: 3, upper: 300, step_increment: 1, page_increment: 10}),
        });
        settings.bind('refresh-seconds', refresh, 'value', Gio.SettingsBindFlags.DEFAULT);
        extras.add(refresh);
    }
}
