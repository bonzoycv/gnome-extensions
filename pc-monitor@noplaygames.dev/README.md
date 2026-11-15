# PC Monitor

Extensión de GNOME Shell que muestra en el panel superior el estado de este PC, con el mismo estilo que [Proxmox VE Monitor](../proxmox-monitor@noplaygames.dev/).

- **Panel:** `PC: CPU 12% 52°C | GPU 4% 45°C | RAM 38%`
- **Menú:**
  - CPU: modelo, uso, temperatura y carga; RAM y swap usadas.
  - GPU (AMD): uso, VRAM, temperaturas (borde, unión y memoria), ventilador y consumo.
  - Discos: temperatura del NVMe y espacio usado de `/`, `/home` y `/boot` (los que existan).
  - Red: tráfico de subida y bajada.
  - Acceso directo al **Monitor del sistema**.

Se actualiza cada 3 segundos. Todo se lee de `/proc` y `/sys`: no necesita servicios, permisos especiales ni configuración.

## Requisitos

- GNOME Shell 45 a 51.
- La temperatura de la CPU sale de `k10temp` (AMD Ryzen) o `coretemp` (Intel).
- Los datos de GPU son para tarjetas AMD con el controlador `amdgpu`. Con otras GPU el menú muestra `GPU: sin datos` y el resto funciona igual.

## Instalación

Desde la raíz del repositorio:

```bash
./install.sh pc-monitor
```

Cierra sesión y vuelve a entrar (en Wayland), y actívala con la app **Extensiones** o con:

```bash
gnome-extensions enable pc-monitor@noplaygames.dev
```

## Configuración

No tiene ventana de preferencias. Lo que se puede ajustar está al principio de `extension.js`:

| Constante | Para qué sirve |
|-----------|----------------|
| `REFRESH_SECONDS` | Cada cuántos segundos se actualiza (3 por defecto). |
| `MOUNTS` | Puntos de montaje que se muestran y su nombre. |
| `IGNORED_NET` | Interfaces de red que no cuentan para el tráfico (loopback, Docker, VPN…). |

Después de cambiarlas, vuelve a ejecutar `./install.sh pc-monitor` (o usa `--link`) y cierra sesión.

## Licencia

GPL-2.0-or-later.
