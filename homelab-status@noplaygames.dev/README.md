# Homelab Status

Extensión de GNOME Shell que muestra en el panel superior el estado de tu homelab. Para eso corre por SSH un script de chequeo en el servidor.

- **Panel:** `🟢 Lab` si todo está bien, `🟡 Lab 2` si hay avisos y `🔴 Lab 1` si hay fallas. `⚫ Lab` significa que no se pudo conectar.
- **Menú:**
  - Resumen con la hora de la última consulta.
  - Los problemas primero.
  - El detalle en submenús plegables: Contenedores, Backups, Sitios y Sistema.
  - Botones: **Actualizar ahora**, **Abrir panel web** (opcional) y **Preferencias**.
- **Notificaciones:** avisa cuando aparece un problema nuevo, no en cada actualización.

Se actualiza cada 5 minutos (configurable).

## Cómo funciona

La extensión ejecuta:

```bash
ssh -o BatchMode=yes <host> <comando>
```

Lee las líneas de la salida que empiezan con `OK`, `AVISO` o `FALLA`:

```text
OK     contenedor caddy: Up 31 hours
AVISO  disco / al 83 %
FALLA  https://ejemplo.org no responde
```

Cualquier script que imprima ese formato sirve. Las líneas se agrupan por su texto: las que empiezan con `contenedor` van a Contenedores, las que mencionan `backup` o `copia` van a Backups, las que tienen una URL o dicen `responde` van a Sitios, y el resto va a Sistema.

La extensión no guarda contraseñas: usa tu `~/.ssh/config` y tu llave SSH. El host tiene que aceptar la conexión sin pedir contraseña. Para comprobarlo:

```bash
ssh -o BatchMode=yes mi-servidor true && echo OK
```

## Instalación

Desde la raíz del repositorio:

```bash
./install.sh homelab-status
```

Cierra sesión y vuelve a entrar (en Wayland), y actívala con la app **Extensiones**.

## Configuración

Abre **Preferencias** desde el menú de la extensión o con `gnome-extensions prefs homelab-status@noplaygames.dev`.

| Ajuste | Ejemplo |
|--------|---------|
| Host SSH | `mi-servidor` (un alias de `~/.ssh/config`) o `usuario@192.168.1.20` |
| Comando remoto | `~/scripts/estado.sh` |
| Actualizar cada | `5` minutos |
| Avisar de problemas nuevos | Activado |
| Avisar también al iniciar sesión | Desactivado: solo avisa de lo que cambie después |
| URL de un panel web | `http://192.168.1.20:3001` (Uptime Kuma, Homepage…), opcional |

## Licencia

GPL-2.0-or-later.
