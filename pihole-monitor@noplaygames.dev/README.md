# Pi-hole Monitor

Extensión de GNOME Shell que muestra las estadísticas de **Pi-hole v6** en el panel superior y permite pausar el bloqueo.

- **Panel:** `🛡️ 14%` es el porcentaje de consultas bloqueadas hoy. Con el bloqueo en pausa muestra `⏸️ 4:32`, el tiempo que falta para que vuelva.
- **Menú:**
  - Estado del bloqueo, consultas de hoy, bloqueadas, desde caché y reenviadas, clientes activos y dominios en las listas.
  - **Pausar bloqueo** 5 minutos, 30 minutos o hasta reanudarlo, y **Reanudar bloqueo**.
  - **Abrir panel de Pi-hole** y **Preferencias**.
- **Pi-hole de respaldo (opcional):** si tienes un segundo Pi-hole como DNS secundario, el menú muestra su estado, sus consultas, sus dominios y cuándo se actualizaron sus listas. Si deja de responder, el panel agrega `⚠️` (`🛡️ 14% ⚠️`). Con su contraseña de aplicación, **Pausar** y **Reanudar** actúan sobre los dos a la vez; sin contraseña, solo se comprueba si responde.

Se actualiza cada 30 segundos (configurable). Solo funciona con Pi-hole v6 o superior, porque usa la API `/api`. Las versiones 5 y anteriores tenían otra API.

## Instalación

Desde la raíz del repositorio:

```bash
./install.sh pihole-monitor
```

Cierra sesión y vuelve a entrar (en Wayland), y actívala con la app **Extensiones**.

## Configuración

1. En Pi-hole, abre **Settings → Web interface / API**, activa el modo **Expert** y pulsa **Configure app password**. Copia la contraseña que genera y guárdala: Pi-hole la muestra una sola vez.
2. Abre las **Preferencias** de la extensión y completa:

| Ajuste | Ejemplo |
|--------|---------|
| Dirección | `http://192.168.1.2:8080` (sin `/admin`) |
| Contraseña de aplicación | La del paso 1 |
| Aceptar certificados autofirmados | Solo importa si usas `https` |
| Respaldo: dirección | `http://192.168.1.3:8080` (opcional) |
| Respaldo: contraseña de aplicación | La del Pi-hole de respaldo (opcional) |
| Actualizar cada | `30` segundos |

Si sincronizas los dos Pi-hole (por ejemplo con [nebula-sync](https://github.com/lovelaze/nebula-sync)), cambia las listas siempre en el principal. La contraseña de aplicación de cada uno es independiente y no se sincroniza.

Los cambios se aplican al momento, sin cerrar sesión.

### Seguridad

- La contraseña de aplicación da **acceso completo** a la API de Pi-hole: Pi-hole v6 no tiene contraseñas de solo lectura.
- Se guarda en GSettings (dconf), en `/org/gnome/shell/extensions/pihole-monitor/`, dentro de tu carpeta personal y sin cifrar. Nunca queda en el código ni en el repositorio.
- Si sospechas que alguien la vio, genera otra desde el mismo menú de Pi-hole.
- Pi-hole admite pocas sesiones a la vez. La extensión reutiliza la misma sesión y la cierra al desactivarse.

## Problemas comunes

- **`🛡️ ✕` con «contraseña de aplicación incorrecta»**: genera una nueva y vuelve a pegarla.
- **`HTTP 429`**: Pi-hole llegó a su límite de sesiones. Espera unos minutos o sube `webserver.api.max_sessions`.
- Para ver los detalles:

  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell | grep PiholeMonitor
  ```

## Licencia

GPL-2.0-or-later.
