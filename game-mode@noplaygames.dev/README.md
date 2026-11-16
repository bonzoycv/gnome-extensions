# Modo juego

Extensión de GNOME Shell que agrega un interruptor **Modo juego** a los ajustes rápidos, el menú de la esquina superior derecha.

- **Al encenderlo** cambia el perfil de [TuneD](https://tuned-project.org/) a uno de rendimiento (`latency-performance` por defecto) y recuerda cuál estaba antes.
- **Al apagarlo** vuelve a ese perfil (`desktop`, `balanced`…).
- **Con GameMode:** cuando un juego activa [Feral GameMode](https://github.com/FeralInteractive/gamemode) (con `gamemoderun %command%` en Steam, Lutris, Heroic…), aparece un ícono de mando en el panel. Si la opción está activa, el modo juego se enciende solo y se apaga al cerrar el último juego.
- Debajo del interruptor se ve el perfil activo, o cuántos juegos usan GameMode.

Si cambias de perfil desde fuera (`tuned-adm profile …`), el interruptor se actualiza solo.

## Requisitos

- **TuneD** instalado y en marcha (`systemctl status tuned`). Su política de polkit deja que la sesión activa cambie de perfil sin pedir contraseña.
- **GameMode** (opcional) para la detección automática.

## Instalación

Desde la raíz del repositorio:

```bash
./install.sh game-mode
```

Cierra sesión y vuelve a entrar (en Wayland), y actívala con la app **Extensiones**.

## Configuración

En **Preferencias** (`gnome-extensions prefs game-mode@noplaygames.dev`):

| Ajuste | Por defecto |
|--------|-------------|
| Perfil para jugar | `latency-performance` |
| Perfil normal | `desktop` (se actualiza solo con el que tenías al encender el modo juego) |
| Activar automáticamente con GameMode | Activado |

Otras opciones para jugar son `throughput-performance` y `accelerator-performance`. Puedes ver todos los perfiles con `tuned-adm list`.

Si bloqueas la pantalla o desactivas la extensión con el modo juego encendido, el perfil no cambia, para no cortar una partida. Al apagar el interruptor se vuelve al perfil normal.

## Licencia

GPL-2.0-or-later.
