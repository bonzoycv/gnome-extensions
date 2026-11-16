// Homelab Status: corre por SSH un script de chequeo en el servidor y muestra el resultado en el panel.
// El script imprime una línea por chequeo que empieza con OK, AVISO o FALLA (el formato de
// estado-homelab.sh). La extensión no guarda contraseñas: usa la configuración SSH del usuario
// (~/.ssh/config y su agente de llaves).
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const RUN_TIMEOUT_SECONDS = 60;
const LEVELS = {OK: 0, AVISO: 1, FALLA: 2};
const DOTS = ['🟢', '🟡', '🔴'];

// Agrupa cada línea del chequeo según su texto.
const CATEGORIES = [
    ['Contenedores', /^contenedor /],
    ['Backups', /backup|copia/i],
    ['Sitios', /https?:\/\/|responde/],
    ['Sistema', /.*/],
];

function parseReport(text) {
    const checks = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^(OK|AVISO|FALLA)\s+(.+)$/);
        if (m)
            checks.push({level: LEVELS[m[1]], text: m[2].trim()});
    }
    return checks;
}

function categoryOf(text) {
    return CATEGORIES.find(([, re]) => re.test(text))[0];
}

const HomelabIndicator = GObject.registerClass(
class HomelabIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Homelab Status');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._running = false;
        this._lastProblems = new Set();
        this._firstRun = true;

        this._panelLabel = new St.Label({
            text: '⚪ Lab',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelLabel);

        this._summaryItem = new PopupMenu.PopupMenuItem('Consultando…', {reactive: false});
        this.menu.addMenuItem(this._summaryItem);

        this._problemSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._problemSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._detailSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._detailSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refresh = new PopupMenu.PopupMenuItem('Actualizar ahora');
        refresh.connect('activate', () => this._run());
        this.menu.addMenuItem(refresh);

        this._linkItem = new PopupMenu.PopupMenuItem('Abrir panel web');
        this._linkItem.connect('activate', () => {
            const url = this._settings.get_string('dashboard-url').trim();
            if (url)
                Gio.AppInfo.launch_default_for_uri(url, null);
        });
        this.menu.addMenuItem(this._linkItem);

        const prefs = new PopupMenu.PopupMenuItem('Preferencias');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this._settingsId = this._settings.connect('changed', (s, key) => {
            if (key === 'dashboard-url')
                this._syncLink();
            else if (key === 'refresh-minutes')
                this._restartTimer();
        });
        this._syncLink();
        this._restartTimer();
    }

    _syncLink() {
        this._linkItem.visible = this._settings.get_string('dashboard-url').trim() !== '';
    }

    _restartTimer() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._run();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-minutes') * 60,
            () => {
                this._run();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _run() {
        if (this._running)
            return;
        const host = this._settings.get_string('ssh-host').trim();
        const command = this._settings.get_string('remote-command').trim();
        if (!host || !command) {
            this._panelLabel.set_text('⚪ Lab');
            this._summaryItem.label.set_text('Falta configurar el host SSH y el comando (abre Preferencias).');
            return;
        }

        this._running = true;
        this._cancellable = new Gio.Cancellable();
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RUN_TIMEOUT_SECONDS, () => {
            this._cancellable?.cancel();
            return GLib.SOURCE_REMOVE;
        });

        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            GLib.source_remove(timeoutId);
            this._running = false;
            this._showError(e.message);
            return;
        }

        proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
            GLib.source_remove(timeoutId);
            this._running = false;
            if (!this._settings)
                return; // el indicador ya se destruyó
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                const checks = parseReport(stdout || '');
                if (checks.length === 0) {
                    this._showError((stderr || '').trim().split('\n').pop() ||
                        `el comando terminó con código ${p.get_exit_status()} sin datos`);
                    return;
                }
                this._showChecks(checks);
            } catch (e) {
                this._showError(e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
                    ? `sin respuesta tras ${RUN_TIMEOUT_SECONDS} s` : e.message);
            }
        });
    }

    _showError(message) {
        this._panelLabel.set_text('⚫ Lab');
        this._summaryItem.label.set_text(`No se pudo consultar: ${message}`);
        this._problemSection.removeAll();
        this._detailSection.removeAll();
        console.error(`[HomelabStatus] ${message}`);
    }

    _showChecks(checks) {
        const fallas = checks.filter(c => c.level === 2);
        const avisos = checks.filter(c => c.level === 1);
        const worst = fallas.length ? 2 : avisos.length ? 1 : 0;
        const problems = [...fallas, ...avisos];

        this._panelLabel.set_text(problems.length ? `${DOTS[worst]} Lab ${problems.length}` : `${DOTS[0]} Lab`);

        const now = GLib.DateTime.new_now_local().format('%H:%M');
        this._summaryItem.label.set_text(problems.length
            ? `${fallas.length} falla(s), ${avisos.length} aviso(s) · ${now}`
            : `Todo en orden (${checks.length} chequeos) · ${now}`);

        this._problemSection.removeAll();
        for (const c of problems) {
            this._problemSection.addMenuItem(
                new PopupMenu.PopupMenuItem(`${DOTS[c.level]} ${c.text}`, {reactive: false}));
        }

        // Detalle por categoría, en submenús plegables.
        this._detailSection.removeAll();
        for (const [name] of CATEGORIES) {
            const items = checks.filter(c => categoryOf(c.text) === name);
            if (!items.length)
                continue;
            const catWorst = Math.max(...items.map(c => c.level));
            const sub = new PopupMenu.PopupSubMenuMenuItem(`${DOTS[catWorst]} ${name} (${items.length})`);
            for (const c of items)
                sub.menu.addMenuItem(new PopupMenu.PopupMenuItem(`${DOTS[c.level]} ${c.text}`, {reactive: false}));
            this._detailSection.addMenuItem(sub);
        }

        this._notifyNewProblems(problems);
    }

    // Avisa solo de los problemas nuevos, no en cada actualización.
    _notifyNewProblems(problems) {
        // Se ignoran los números (horas, porcentajes) para no repetir el aviso cuando solo cambian.
        const key = c => c.text.replace(/\d+/g, '#');
        const current = new Set(problems.map(key));
        const fresh = problems.filter(c => !this._lastProblems.has(key(c)));
        this._lastProblems = current;

        if (this._firstRun) {
            this._firstRun = false;
            if (!this._settings.get_boolean('notify-on-start'))
                return;
        }
        if (!fresh.length || !this._settings.get_boolean('notify'))
            return;
        try {
            Main.notify('Homelab', fresh.map(c => `${DOTS[c.level]} ${c.text}`).join('\n'));
        } catch (e) {
            console.error(`[HomelabStatus] notificación: ${e.message}`);
        }
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        this._settings = null;
        super.destroy();
    }
});

export default class HomelabStatusExtension extends Extension {
    enable() {
        this._indicator = new HomelabIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
