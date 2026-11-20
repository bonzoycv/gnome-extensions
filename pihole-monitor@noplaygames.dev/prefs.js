// Ventana de preferencias de Pi-hole Monitor.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PiholeMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'security-high-symbolic'});
        window.add(page);

        const server = new Adw.PreferencesGroup({
            title: 'Pi-hole',
            description: 'Para Pi-hole v6. La contraseña de aplicación se crea en Settings → Web interface / API → Configure app password.',
        });
        page.add(server);

        const url = new Adw.EntryRow({title: 'Dirección (p. ej. http://192.168.1.2:8080)'});
        settings.bind('url', url, 'text', Gio.SettingsBindFlags.DEFAULT);
        server.add(url);

        const password = new Adw.PasswordEntryRow({title: 'Contraseña de aplicación'});
        settings.bind('app-password', password, 'text', Gio.SettingsBindFlags.DEFAULT);
        server.add(password);

        const certs = new Adw.SwitchRow({
            title: 'Aceptar certificados autofirmados',
            subtitle: 'Solo importa si la dirección usa https.',
        });
        settings.bind('accept-invalid-certs', certs, 'active', Gio.SettingsBindFlags.DEFAULT);
        server.add(certs);

        const replica = new Adw.PreferencesGroup({
            title: 'Pi-hole de respaldo (opcional)',
            description: 'Si tienes un segundo Pi-hole como DNS secundario. Con su contraseña de aplicación, el menú muestra su estado y «Pausar bloqueo» pausa los dos a la vez. Sin contraseña, solo se comprueba si responde.',
        });
        page.add(replica);

        const replicaUrl = new Adw.EntryRow({title: 'Dirección (p. ej. http://192.168.1.3:8080)'});
        settings.bind('replica-url', replicaUrl, 'text', Gio.SettingsBindFlags.DEFAULT);
        replica.add(replicaUrl);

        const replicaPassword = new Adw.PasswordEntryRow({title: 'Contraseña de aplicación'});
        settings.bind('replica-app-password', replicaPassword, 'text', Gio.SettingsBindFlags.DEFAULT);
        replica.add(replicaPassword);

        const other = new Adw.PreferencesGroup({title: 'Otros'});
        page.add(other);
        const refresh = new Adw.SpinRow({
            title: 'Actualizar cada (segundos)',
            adjustment: new Gtk.Adjustment({lower: 5, upper: 600, step_increment: 5, page_increment: 30}),
        });
        settings.bind('refresh-seconds', refresh, 'value', Gio.SettingsBindFlags.DEFAULT);
        other.add(refresh);

        const failures = new Adw.SpinRow({
            title: 'Fallas seguidas antes de marcar en rojo',
            subtitle: 'Antes se muestran los últimos datos con un aviso en amarillo. Con 1, se marca en rojo a la primera falla.',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 20, step_increment: 1, page_increment: 5}),
        });
        settings.bind('failures-before-alert', failures, 'value', Gio.SettingsBindFlags.DEFAULT);
        other.add(failures);
    }
}
