// Pi-hole Monitor: estadísticas de Pi-hole v6 en el panel y botones para pausar o reanudar el bloqueo.
// Usa la API REST de Pi-hole v6 (/api) con una contraseña de aplicación guardada en GSettings.
// Opcionalmente vigila un segundo Pi-hole de respaldo (el DNS secundario de la red): muestra su estado
// y, si tiene contraseña, pausa y reanuda el bloqueo en los dos a la vez.
// Cada sesión (SID) se reutiliza mientras sea válida y se cierra al desactivar la extensión, porque
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

function fmtAgo(unixSeconds) {
    if (!unixSeconds)
        return '—';
    const min = Math.max(0, Math.round((Date.now() / 1000 - unixSeconds) / 60));
    if (min < 60)
        return `hace ${min} min`;
    const h = Math.round(min / 60);
    return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

function errorText(e) {
    return e instanceof HttpError && e.status === 401 ? 'contraseña de aplicación incorrecta' : e.message;
}

// Un servidor Pi-hole: dirección, contraseña y sesión propia.
class PiholeClient {
    constructor(session, settings, urlKey, passwordKey) {
        this._session = session;
        this._settings = settings;
        this._urlKey = urlKey;
        this._passwordKey = passwordKey;
        this._sid = null;
    }

    get baseUrl() {
        return this._settings.get_string(this._urlKey).trim().replace(/\/+$/, '').replace(/\/admin$/, '');
    }

    get hasPassword() {
        return this._settings.get_string(this._passwordKey) !== '';
    }

    _request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new(method, `${this.baseUrl}/api${path}`);
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
        const res = await this._request('POST', '/auth', {password: this._settings.get_string(this._passwordKey)});
        if (!res.session?.valid)
            throw new Error(res.session?.message || 'contraseña rechazada');
        // Sin contraseña configurada en Pi-hole, la sesión es válida pero sin SID.
        this._sid = res.session.sid ?? null;
    }

    // Hace la petición; si la sesión venció (401), inicia sesión de nuevo y reintenta una vez.
    async api(method, path, body = null) {
        if (!this._sid && this.hasPassword)
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

    // Sin contraseña: Pi-hole responde 401 a /api/auth si está en marcha.
    async ping() {
        try {
            await this._request('GET', '/auth');
        } catch (e) {
            if (!(e instanceof HttpError && e.status === 401))
                throw e;
        }
    }

    logout() {
        if (!this._sid)
            return;
        // Sin esperar respuesta: solo libera la sesión en Pi-hole.
        this._request('DELETE', '/auth').catch(() => {});
        this._sid = null;
    }
}

const PiholeIndicator = GObject.registerClass(
class PiholeIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Pi-hole Monitor');

        this._extension = extension;
        this._settings = extension.getSettings();

        this._session = new Soup.Session();
        this._session.timeout = 8;

        this._primary = new PiholeClient(this._session, this._settings, 'url', 'app-password');
        this._replica = new PiholeClient(this._session, this._settings, 'replica-url', 'replica-app-password');

        this._panelLabel = new St.Label({
            text: '🛡️ …',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelLabel);

        this._statsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._statsSection);

        this._replicaSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._replicaSection);
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
            const base = this._primary.baseUrl;
            if (base)
                Gio.AppInfo.launch_default_for_uri(`${base}/admin/`, null);
        });
        this.menu.addMenuItem(web);

        this._replicaWebItem = new PopupMenu.PopupMenuItem('Abrir panel del respaldo');
        this._replicaWebItem.connect('activate', () => {
            const base = this._replica.baseUrl;
            if (base)
                Gio.AppInfo.launch_default_for_uri(`${base}/admin/`, null);
        });
        this.menu.addMenuItem(this._replicaWebItem);

        const prefs = new PopupMenu.PopupMenuItem('Preferencias');
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this._primaryState = null;
        this._replicaState = null;
        this._syncActions(null);

        this._settingsId = this._settings.connect('changed', (s, key) => {
            if (key === 'url' || key === 'app-password')
                this._primary.logout();
            if (key === 'replica-url' || key === 'replica-app-password')
                this._replica.logout();
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

    // Estado de un Pi-hole: {ok, summary, blocking} o {ok: false, error}.
    async _fetchState(client) {
        try {
            const [summary, blocking] = await Promise.all([
                client.api('GET', '/stats/summary'),
                client.api('GET', '/dns/blocking'),
            ]);
            return {ok: true, summary, blocking};
        } catch (e) {
            return {ok: false, error: errorText(e)};
        }
    }

    async _fetchReplica() {
        if (!this._replica.baseUrl)
            return null;
        if (this._replica.hasPassword)
            return this._fetchState(this._replica);
        try {
            await this._replica.ping();
            return {ok: true, pingOnly: true};
        } catch (e) {
            return {ok: false, error: errorText(e)};
        }
    }

    async _update() {
        if (!this._primary.baseUrl) {
            this._panelLabel.set_text('🛡️ ?');
            this._statsSection.removeAll();
            this._replicaSection.removeAll();
            this._statsSection.addMenuItem(new PopupMenu.PopupMenuItem(
                'Falta configurar la dirección de Pi-hole (abre Preferencias).', {reactive: false}));
            this._syncActions(null);
            return;
        }

        const [primary, replica] = await Promise.all([this._fetchState(this._primary), this._fetchReplica()]);
        if (!this._session)
            return; // el indicador se destruyó mientras se esperaba

        this._primaryState = primary;
        this._replicaState = replica;
        this._show();
    }

    _show() {
        const primary = this._primaryState;
        const replica = this._replicaState;
        const item = (section, text) => section.addMenuItem(new PopupMenu.PopupMenuItem(text, {reactive: false}));
        const replicaWarn = replica && !replica.ok ? ' ⚠️' : '';

        this._statsSection.removeAll();
        if (!primary.ok) {
            this._panelLabel.set_text(`🛡️ ✕${replicaWarn}`);
            item(this._statsSection, `No se pudo consultar: ${primary.error}`);
            console.error(`[PiholeMonitor] principal: ${primary.error}`);
            this._syncActions(null);
        } else {
            const {summary, blocking} = primary;
            const q = summary.queries ?? {};
            const enabled = blocking.blocking === 'enabled';
            const pct = Number(q.percent_blocked ?? 0);

            if (enabled)
                this._panelLabel.set_text(`🛡️ ${pct.toFixed(0)}%${replicaWarn}`);
            else
                this._panelLabel.set_text(`${blocking.timer ? `⏸️ ${fmtTimer(blocking.timer)}` : '⏸️ Pi-hole'}${replicaWarn}`);

            if (enabled)
                item(this._statsSection, '🟢 Bloqueo activo');
            else
                item(this._statsSection, blocking.timer ? `🟡 Bloqueo en pausa (vuelve en ${fmtTimer(blocking.timer)})` : '🔴 Bloqueo desactivado');
            item(this._statsSection, `Consultas hoy: ${fmtInt(q.total)}`);
            item(this._statsSection, `Bloqueadas: ${fmtInt(q.blocked)} (${pct.toFixed(1)}%)`);
            item(this._statsSection, `Desde caché: ${fmtInt(q.cached)} · Reenviadas: ${fmtInt(q.forwarded)}`);
            item(this._statsSection, `Clientes activos: ${fmtInt(summary.clients?.active)}`);
            item(this._statsSection, `Dominios en las listas: ${fmtInt(summary.gravity?.domains_being_blocked)}`);
            this._syncActions(enabled);
        }

        // Respaldo
        this._replicaSection.removeAll();
        this._replicaWebItem.visible = replica !== null;
        if (!replica)
            return;
        this._replicaSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Respaldo'));
        if (!replica.ok) {
            item(this._replicaSection, `🔴 No responde: ${replica.error}`);
            console.error(`[PiholeMonitor] respaldo: ${replica.error}`);
        } else if (replica.pingOnly) {
            item(this._replicaSection, '🟢 Responde (sin contraseña: no se ven sus datos)');
        } else {
            const rEnabled = replica.blocking.blocking === 'enabled';
            const rq = replica.summary.queries ?? {};
            item(this._replicaSection, rEnabled
                ? '🟢 Bloqueo activo'
                : replica.blocking.timer
                    ? `🟡 Bloqueo en pausa (vuelve en ${fmtTimer(replica.blocking.timer)})`
                    : '🔴 Bloqueo desactivado');
            item(this._replicaSection, `Consultas hoy: ${fmtInt(rq.total)} · Bloqueadas: ${fmtInt(rq.blocked)}`);
            item(this._replicaSection,
                `Dominios: ${fmtInt(replica.summary.gravity?.domains_being_blocked)} · listas ${fmtAgo(replica.summary.gravity?.last_update)}`);
        }
    }

    // enabled: true, false o null (sin datos: se ocultan las acciones).
    _syncActions(enabled) {
        for (const it of this._pauseItems)
            it.visible = enabled === true;
        this._resumeItem.visible = enabled === false;
    }

    // Pausa o reanuda en el principal y, si tiene contraseña, también en el respaldo.
    async _setBlocking(blocking, timerSeconds = 0) {
        const body = {blocking};
        if (!blocking && timerSeconds > 0)
            body.timer = timerSeconds;

        const targets = [['principal', this._primary]];
        if (this._replica.baseUrl && this._replica.hasPassword)
            targets.push(['respaldo', this._replica]);

        const results = await Promise.allSettled(targets.map(([, c]) => c.api('POST', '/dns/blocking', body)));
        const failed = results
            .map((r, i) => (r.status === 'rejected' ? `${targets[i][0]}: ${errorText(r.reason)}` : null))
            .filter(Boolean);
        if (failed.length)
            Main.notify('Pi-hole', `No se pudo cambiar el bloqueo (${failed.join('; ')})`);
        this._update();
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
        this._primary.logout();
        this._replica.logout();
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
