// PC Monitor: el estado de este PC en el panel superior, con el mismo estilo que Proxmox VE Monitor.
// Todo se lee de /proc y /sys (sin servicios externos). Los sensores se buscan por nombre en cada
// lectura, porque el número de hwmonN puede cambiar entre reinicios.
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_SECONDS = 3;
// Puntos de montaje que se muestran (los que no existan se omiten).
const MOUNTS = [['/', 'Sistema'], ['/home', 'Home'], ['/boot', 'Boot']];
// Interfaces de red que no cuentan para el tráfico.
const IGNORED_NET = /^(lo|veth|docker|br-|virbr|tun|tap|wg)/;
const GiB = 1073741824;

const decoder = new TextDecoder('utf-8');

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes).trim() : null;
    } catch {
        return null;
    }
}

function readNum(path) {
    const t = readText(path);
    const n = t === null ? NaN : Number(t);
    return Number.isFinite(n) ? n : null;
}

function listDir(path) {
    const out = [];
    try {
        const dir = GLib.Dir.open(path, 0);
        let name;
        while ((name = dir.read_name()) !== null)
            out.push(name);
        dir.close();
    } catch {
        // La carpeta no existe: se devuelve vacía.
    }
    return out.sort();
}

// nombre del sensor (k10temp, amdgpu, nvme…) → carpeta /sys/class/hwmon/hwmonN
function hwmonByName() {
    const map = {};
    for (const h of listDir('/sys/class/hwmon')) {
        const name = readText(`/sys/class/hwmon/${h}/name`);
        if (name && !(name in map))
            map[name] = `/sys/class/hwmon/${h}`;
    }
    return map;
}

// Temperatura por etiqueta (Tctl, edge, junction, Composite…) o la primera disponible.
function tempOf(dir, label) {
    if (!dir)
        return null;
    for (const f of listDir(dir)) {
        const m = f.match(/^temp(\d+)_input$/);
        if (!m)
            continue;
        if (label && readText(`${dir}/temp${m[1]}_label`) !== label)
            continue;
        const v = readNum(`${dir}/${f}`);
        if (v !== null)
            return v / 1000;
    }
    return null;
}

function gpuDevice() {
    for (const c of listDir('/sys/class/drm')) {
        if (!/^card\d+$/.test(c))
            continue;
        const dev = `/sys/class/drm/${c}/device`;
        if (readNum(`${dev}/gpu_busy_percent`) !== null)
            return dev;
    }
    return null;
}

function fmtRate(bytesPerSec) {
    if (bytesPerSec >= 1048576)
        return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? `${d} d ${h} h ${m} min` : `${h} h ${m} min`;
}

const PcIndicator = GObject.registerClass(
class PcIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'PC Monitor');

        this._panelLabel = new St.Label({
            text: 'PC: cargando...',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._panelLabel);

        const model = (readText('/proc/cpuinfo') || '').match(/^model name\s*:\s*(.+)$/m);
        this._cpuModel = model ? model[1].replace(/\s+\d+-Core Processor$/, '') : 'CPU';
        this._host = GLib.get_host_name();
        this._prevCpu = null;
        this._prevNet = null;

        this._cpuSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._cpuSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._gpuSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._gpuSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._diskSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._diskSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._netSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._netSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const open = new PopupMenu.PopupMenuItem('Abrir Monitor del sistema');
        open.connect('activate', () => {
            try {
                Gio.AppInfo.create_from_commandline('gnome-system-monitor', null, Gio.AppInfoCreateFlags.NONE)
                    .launch([], null);
            } catch (e) {
                console.error(`[PcMonitor] ${e.message}`);
            }
        });
        this.menu.addMenuItem(open);

        this._update();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _item(section, text) {
        section.addMenuItem(new PopupMenu.PopupMenuItem(text, {reactive: false}));
    }

    _cpuPercent() {
        const line = (readText('/proc/stat') || '').split('\n')[0];
        const v = line.split(/\s+/).slice(1).map(Number);
        if (v.length < 4)
            return null;
        const idle = v[3] + (v[4] || 0);
        const total = v.reduce((a, b) => a + b, 0);
        const prev = this._prevCpu;
        this._prevCpu = {idle, total};
        if (!prev || total === prev.total)
            return null;
        return 100 * (1 - (idle - prev.idle) / (total - prev.total));
    }

    _memory() {
        const info = {};
        for (const l of (readText('/proc/meminfo') || '').split('\n')) {
            const m = l.match(/^(\w+):\s+(\d+)/);
            if (m)
                info[m[1]] = Number(m[2]) * 1024;
        }
        return info;
    }

    _network() {
        let rx = 0, tx = 0;
        for (const l of (readText('/proc/net/dev') || '').split('\n').slice(2)) {
            const m = l.match(/^\s*([^:]+):\s*(.+)$/);
            if (!m || IGNORED_NET.test(m[1]))
                continue;
            const f = m[2].trim().split(/\s+/).map(Number);
            rx += f[0];
            tx += f[8];
        }
        const now = GLib.get_monotonic_time() / 1e6;
        const prev = this._prevNet;
        this._prevNet = {rx, tx, now};
        if (!prev || now <= prev.now)
            return null;
        return {down: (rx - prev.rx) / (now - prev.now), up: (tx - prev.tx) / (now - prev.now)};
    }

    _update() {
        try {
            const hw = hwmonByName();
            const cpu = this._cpuPercent();
            const cpuTemp = tempOf(hw.k10temp, 'Tctl') ?? tempOf(hw.coretemp, 'Package id 0') ?? tempOf(hw.k10temp);
            const mem = this._memory();
            const ramUsed = (mem.MemTotal || 0) - (mem.MemAvailable || 0);
            const ramPct = mem.MemTotal ? (ramUsed / mem.MemTotal) * 100 : 0;

            // 1. Barra superior: uso y temperatura de CPU y GPU, y uso de RAM
            const gpu = gpuDevice();
            const gpuBusy = gpu ? readNum(`${gpu}/gpu_busy_percent`) : null;
            const gpuTemp = tempOf(hw.amdgpu, 'edge') ?? tempOf(hw.amdgpu);
            const cpuTxt = cpu === null ? '…' : `${cpu.toFixed(0)}%`;
            const deg = (t) => (t === null ? '' : ` ${t.toFixed(0)}°C`);
            const gpuTxt = gpu ? ` | GPU ${gpuBusy ?? '-'}%${deg(gpuTemp)}` : '';
            this._panelLabel.set_text(`CPU ${cpuTxt}${deg(cpuTemp)}${gpuTxt} | RAM ${ramPct.toFixed(0)}%`);

            // 2. CPU y memoria
            this._cpuSection.removeAll();
            const load = (readText('/proc/loadavg') || '').split(' ')[0];
            const up = readNum('/proc/uptime') ?? Number((readText('/proc/uptime') || '0').split(' ')[0]);
            this._item(this._cpuSection, `Equipo: ${this._host} (Load: ${load}) — encendido ${fmtUptime(up)}`);
            this._item(this._cpuSection, `CPU: ${this._cpuModel} — ${cpuTxt}`);
            if (cpuTemp !== null)
                this._item(this._cpuSection, `Temp CPU: ${cpuTemp.toFixed(1)} °C`);
            this._item(this._cpuSection,
                `RAM: ${(ramUsed / GiB).toFixed(1)} / ${((mem.MemTotal || 0) / GiB).toFixed(1)} GB (${ramPct.toFixed(0)}%)`);
            if (mem.SwapTotal) {
                const swapUsed = mem.SwapTotal - (mem.SwapFree || 0);
                this._item(this._cpuSection,
                    `Swap: ${(swapUsed / GiB).toFixed(1)} / ${(mem.SwapTotal / GiB).toFixed(1)} GB`);
            }

            // 3. GPU
            this._gpuSection.removeAll();
            if (gpu) {
                const busy = gpuBusy;
                const vramUsed = readNum(`${gpu}/mem_info_vram_used`);
                const vramTotal = readNum(`${gpu}/mem_info_vram_total`);
                this._item(this._gpuSection, `🎮 GPU: ${busy ?? '-'}%` +
                    (vramUsed !== null && vramTotal ? ` — VRAM ${(vramUsed / GiB).toFixed(1)} / ${(vramTotal / GiB).toFixed(1)} GB` : ''));
                const edge = tempOf(hw.amdgpu, 'edge');
                const junction = tempOf(hw.amdgpu, 'junction');
                const memT = tempOf(hw.amdgpu, 'mem');
                const temps = [edge !== null && `${edge.toFixed(0)} °C`, junction !== null && `unión ${junction.toFixed(0)} °C`,
                    memT !== null && `memoria ${memT.toFixed(0)} °C`].filter(Boolean);
                if (temps.length)
                    this._item(this._gpuSection, `🌡️ Temp GPU: ${temps.join(' · ')}`);
                const fan = hw.amdgpu ? readNum(`${hw.amdgpu}/fan1_input`) : null;
                const power = hw.amdgpu ? (readNum(`${hw.amdgpu}/power1_average`) ?? readNum(`${hw.amdgpu}/power1_input`)) : null;
                const extra = [fan !== null && `ventilador ${fan} RPM`, power !== null && `${(power / 1e6).toFixed(0)} W`].filter(Boolean);
                if (extra.length)
                    this._item(this._gpuSection, `GPU: ${extra.join(' · ')}`);
            } else {
                this._item(this._gpuSection, '🎮 GPU: sin datos');
            }

            // 4. Discos: temperatura del NVMe y espacio de cada punto de montaje
            this._diskSection.removeAll();
            const nvme = tempOf(hw.nvme, 'Composite') ?? tempOf(hw.nvme);
            if (nvme !== null)
                this._item(this._diskSection, `🌡️ NVMe: ${nvme.toFixed(0)} °C`);
            for (const [path, label] of MOUNTS) {
                try {
                    const info = Gio.File.new_for_path(path).query_filesystem_info('filesystem::size,filesystem::free', null);
                    const size = info.get_attribute_uint64('filesystem::size');
                    const free = info.get_attribute_uint64('filesystem::free');
                    if (!size)
                        continue;
                    const used = size - free;
                    this._item(this._diskSection,
                        `💾 ${label} (${path}): ${(used / GiB).toFixed(1)} / ${(size / GiB).toFixed(1)} GB (${((used / size) * 100).toFixed(0)}%)`);
                } catch {
                    // Punto de montaje inexistente: se omite.
                }
            }

            // 5. Red
            this._netSection.removeAll();
            const net = this._network();
            this._item(this._netSection, net
                ? `🌐 Red: ↓ ${fmtRate(net.down)}  ↑ ${fmtRate(net.up)}`
                : '🌐 Red: midiendo…');
        } catch (err) {
            this._panelLabel.set_text('PC: error de lectura');
            console.error(`[PcMonitor] ${err.message}`);
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        super.destroy();
    }
});

export default class PcMonitorExtension extends Extension {
    enable() {
        this._indicator = new PcIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
