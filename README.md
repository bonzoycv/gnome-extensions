# Extensiones de GNOME Shell

Extensiones para GNOME Shell (45 a 51), con el mismo estilo:

| Extensión | Qué hace |
|-----------|----------|
| [PC Monitor](pc-monitor@noplaygames.dev/) | El estado de este PC: CPU, RAM, swap, GPU AMD, temperaturas, discos y red. |
| [Proxmox VE Monitor](proxmox-monitor@noplaygames.dev/) | El estado de un servidor Proxmox VE: CPU, RAM, almacenamiento, VMs, contenedores LXC y temperaturas. |
| [Homelab Status](homelab-status@noplaygames.dev/) | El resultado de un script de chequeo que corre por SSH en el servidor (contenedores, backups, sitios), con notificaciones. |
| [Pi-hole Monitor](pihole-monitor@noplaygames.dev/) | Estadísticas de Pi-hole v6 y botones para pausar o reanudar el bloqueo. |
| [Modo juego](game-mode@noplaygames.dev/) | Interruptor en los ajustes rápidos que cambia el perfil de TuneD, con activación automática por Feral GameMode. |

## Instalación

Necesitas `git` y `glib-compile-schemas` (paquete `libglib2.0-bin` en Debian y derivadas).

```bash
git clone https://github.com/bonzoycv/gnome-extensions.git
cd gnome-extensions
./install.sh
```

Opciones de `install.sh`:

- `./install.sh pc-monitor` instala solo las extensiones cuyo nombre coincida.
- `./install.sh --link` enlaza las carpetas en vez de copiarlas, útil para desarrollar: lo que cambies en el repositorio es lo que carga GNOME.

Si ya había una versión instalada, el script la mueve a `~/.cache/gnome-extensions-backup/` antes de reemplazarla.

En **Wayland** GNOME Shell no se puede reiniciar en caliente: cierra sesión y vuelve a entrar para que cargue la extensión o sus cambios. Después, actívalas con la app **Extensiones** o con:

```bash
gnome-extensions enable proxmox-monitor@noplaygames.dev
```

## Licencia

GPL-2.0-or-later. Consulta [LICENSE](LICENSE).
