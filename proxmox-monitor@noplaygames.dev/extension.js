// Proxmox VE Monitor: el estado de un nodo Proxmox (CPU, RAM, almacenamiento, VMs, LXC y
// temperaturas) en el panel superior. La configuración (host, nodo, token…) está en GSettings y se
// edita desde la ventana de preferencias; no hay datos de conexión en el código.
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const GiB = 1073741824;
const MiB = 1048576;

const ProxmoxIndicator = GObject.registerClass(
class ProxmoxIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Proxmox Monitor');

        this._extension = extension;
        this._settings = extension.getSettings();

        this._panelLabel = new St.Label({
            text: 'PVE: cargando...',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelLabel);

        this._session = new Soup.Session();
        this._session.timeout = 5;

        this._nodeSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._nodeSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._storageSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._storageSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._vmSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._vmSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem('Preferencias');
        prefsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefsItem);

        // Al escribir en Preferencias cada tecla cambia un ajuste: se espera 1 s antes de reconectar.
        this._settingsId = this._settings.connect('changed', () => {
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
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._updateData();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-seconds'),
            () => {
                this._updateData();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _config() {
        const s = this._settings;
        return {
            host: s.get_string('pve-host').trim().replace(/\/+$/, ''),
            node: s.get_string('pve-node').trim(),
            tokenId: s.get_string('token-id').trim(),
            tokenSecret: s.get_string('token-secret').trim(),
            tempsUrl: s.get_string('temps-url').trim(),
            acceptInvalidCerts: s.get_boolean('accept-invalid-certs'),
        };
    }

    _fetchJson(url, auth = null) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            if (!message) {
                reject(new Error(`URL no válida: ${url}`));
                return;
            }
            if (auth) {
                message.request_headers.append('Authorization', auth.header);
                if (auth.acceptInvalidCerts)
                    message.connect('accept-certificate', () => true);
            }

            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        if (message.status_code !== 200) {
                            reject(new Error(`HTTP ${message.status_code}`));
                            return;
                        }
                        const decoder = new TextDecoder('utf-8');
                        resolve(JSON.parse(decoder.decode(bytes.get_data())));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    _showNotConfigured() {
        this._panelLabel.set_text('PVE: sin configurar');
        this._nodeSection.removeAll();
        this._storageSection.removeAll();
        this._vmSection.removeAll();
        this._nodeSection.addMenuItem(new PopupMenu.PopupMenuItem(
            'Falta configurar el servidor y el token (abre Preferencias).', {reactive: false}));
    }

    async _updateData() {
        const cfg = this._config();
        if (!cfg.host || !cfg.node || !cfg.tokenId || !cfg.tokenSecret) {
            this._showNotConfigured();
            return;
        }

        const auth = {
            header: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`,
            acceptInvalidCerts: cfg.acceptInvalidCerts,
        };
        const node = encodeURIComponent(cfg.node);

        try {
            const [nodeRes, resourcesRes, storageRes, temps] = await Promise.all([
                this._fetchJson(`${cfg.host}/api2/json/nodes/${node}/status`, auth),
                this._fetchJson(`${cfg.host}/api2/json/cluster/resources?type=vm`, auth),
                this._fetchJson(`${cfg.host}/api2/json/nodes/${node}/storage`, auth),
                cfg.tempsUrl ? this._fetchJson(cfg.tempsUrl).catch(() => null) : Promise.resolve(null),
            ]);

            // El indicador pudo destruirse mientras se esperaba la respuesta.
            if (!this._session)
                return;

            const nodeStatus = nodeRes.data;
            const resources = resourcesRes.data;
            const storages = storageRes.data;

            // 1. Barra superior
            const cpuPct = (nodeStatus.cpu * 100).toFixed(1);
            const ramPct = ((nodeStatus.memory.used / nodeStatus.memory.total) * 100).toFixed(0);
            const hasCpuTemp = temps && temps.cpu !== null && temps.cpu !== undefined;
            const tempSuffix = hasCpuTemp ? ` | ${temps.cpu}°C` : '';

            this._panelLabel.set_text(`PVE: CPU ${cpuPct}% | RAM ${ramPct}%${tempSuffix}`);

            // 2. Nodo y temperaturas
            this._nodeSection.removeAll();
            const ramUsedGB = (nodeStatus.memory.used / GiB).toFixed(1);
            const ramTotalGB = (nodeStatus.memory.total / GiB).toFixed(1);

            this._nodeSection.addMenuItem(new PopupMenu.PopupMenuItem(
                `Nodo: ${cfg.node} (Load: ${nodeStatus.loadavg[0]})`, {reactive: false}));
            this._nodeSection.addMenuItem(new PopupMenu.PopupMenuItem(
                `RAM: ${ramUsedGB} / ${ramTotalGB} GB (${ramPct}%)`, {reactive: false}));

            if (temps) {
                if (hasCpuTemp) {
                    this._nodeSection.addMenuItem(new PopupMenu.PopupMenuItem(
                        `Temp CPU: ${temps.cpu} °C`, {reactive: false}));
                }
                for (const [name, t] of Object.entries(temps.disks || {})) {
                    this._nodeSection.addMenuItem(new PopupMenu.PopupMenuItem(
                        `🌡️ ${name}: ${t} °C`, {reactive: false}));
                }
            }

            // 3. Almacenamientos (capacidad y espacio usado)
            this._storageSection.removeAll();
            storages.sort((a, b) => a.storage.localeCompare(b.storage));

            for (const st of storages) {
                if (!st.active || !st.total)
                    continue;
                const usedGB = (st.used / GiB).toFixed(1);
                const totalGB = (st.total / GiB).toFixed(1);
                const pct = ((st.used / st.total) * 100).toFixed(0);

                this._storageSection.addMenuItem(new PopupMenu.PopupMenuItem(
                    `💾 ${st.storage} (${st.type}): ${usedGB} / ${totalGB} GB (${pct}%)`, {reactive: false}));
            }

            // 4. VMs y LXC
            this._vmSection.removeAll();
            resources.sort((a, b) => a.vmid - b.vmid);

            for (const vm of resources) {
                const running = vm.status === 'running';
                const icon = running ? '🟢' : '⚪';
                const typeLabel = vm.type === 'lxc' ? 'LXC' : 'VM';
                const vmCpu = running ? `${(vm.cpu * 100).toFixed(1)}%` : '-';
                const vmRam = running ? `${(vm.mem / MiB).toFixed(0)}MB` : '-';

                this._vmSection.addMenuItem(new PopupMenu.PopupMenuItem(
                    `${icon} [${typeLabel} ${vm.vmid}] ${vm.name}  —  CPU: ${vmCpu} | RAM: ${vmRam}`,
                    {reactive: false}));
            }
        } catch (err) {
            if (!this._session)
                return;
            this._panelLabel.set_text('PVE: Error de conexión');
            console.error(`[ProxmoxMonitor] ${err.message}`);
        }
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = null;
        }
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        this._settings = null;
        super.destroy();
    }
});

export default class ProxmoxMonitorExtension extends Extension {
    enable() {
        this._indicator = new ProxmoxIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
