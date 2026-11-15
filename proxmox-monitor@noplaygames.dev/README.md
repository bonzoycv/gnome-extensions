# Proxmox VE Monitor

Extensión de GNOME Shell que muestra en el panel superior el estado de un nodo de Proxmox VE.

- **Panel:** `PVE: CPU 3.2% | RAM 41% | 48°C`
- **Menú:**
  - Nodo: carga (load average), RAM usada y total, temperatura de la CPU y de los discos.
  - Almacenamiento: cada storage activo con su tipo, espacio usado, total y porcentaje.
  - VMs y contenedores LXC: estado (🟢 encendida, ⚪ apagada), CPU y RAM de cada una.
  - Acceso directo a **Preferencias**.

Se actualiza cada 10 segundos (configurable). Solo lee datos: no enciende, apaga ni cambia nada en el servidor.

## Instalación

Desde la raíz del repositorio:

```bash
./install.sh proxmox-monitor
```

Cierra sesión y vuelve a entrar (en Wayland), y actívala con la app **Extensiones**.

## Configuración

Mientras no esté configurada, el panel muestra `PVE: sin configurar`. Abre las preferencias desde el menú de la extensión, desde la app **Extensiones** o con:

```bash
gnome-extensions prefs proxmox-monitor@noplaygames.dev
```

| Ajuste | Ejemplo |
|--------|---------|
| Dirección | `https://192.168.1.10:8006` |
| Nombre del nodo | `pve` (el que aparece bajo *Datacenter*) |
| Aceptar certificados autofirmados | Activado si Proxmox usa su certificado por defecto |
| ID del token | `monitor@pve!gnome` |
| Secreto del token | El UUID que Proxmox muestra al crear el token |
| URL de temperaturas | `http://192.168.1.10:9105` (opcional) |
| Actualizar cada | `10` segundos |

Los cambios se aplican al momento, sin cerrar sesión.

### Crear un token de solo lectura en Proxmox

1. En la interfaz web: **Datacenter → Permissions → Users → Add** y crea un usuario, por ejemplo `monitor` en el realm `pve`.
2. **Datacenter → Permissions → Add → User Permission**: ruta `/`, usuario `monitor@pve`, rol `PVEAuditor`.
3. **Datacenter → Permissions → API Tokens → Add**: usuario `monitor@pve`, ID `gnome`. Si dejas marcado *Privilege Separation*, dale también al token el rol `PVEAuditor` en `/` (**Add → API Token Permission**).
4. Copia el secreto: Proxmox lo muestra una sola vez.

### Dónde se guarda el token

En GSettings (dconf), en `/org/gnome/shell/extensions/proxmox-monitor/`, dentro de tu carpeta personal. No está en el código ni en el repositorio. Ten en cuenta que dconf no está cifrado: cualquier programa que corra con tu usuario puede leerlo. Por eso conviene que el token sea de solo lectura (`PVEAuditor`).

## Temperaturas (opcional)

La API de Proxmox no da temperaturas. Si configuras la **URL de temperaturas**, la extensión hace un `GET` a esa dirección (sin autenticación) y espera un JSON así:

```json
{
  "cpu": 48,
  "disks": {
    "nvme0n1": 41,
    "sda": 35
  }
}
```

- `cpu`: temperatura de la CPU en °C, o `null` si no se conoce.
- `disks`: nombre del disco → temperatura en °C. Puede estar vacío.

Cualquier servicio pequeño en el servidor que lea `sensors` o `smartctl` y responda ese JSON sirve. Si la URL está vacía o no responde, la extensión sigue funcionando sin temperaturas.

## Problemas comunes

- **`PVE: Error de conexión`**: revisa la dirección, el nombre del nodo y el token. Los detalles quedan en el registro:

  ```bash
  journalctl -f -o cat /usr/bin/gnome-shell | grep ProxmoxMonitor
  ```

- **HTTP 401**: el ID o el secreto del token no son correctos.
- **HTTP 403**: el token no tiene permisos; dale el rol `PVEAuditor` (también al token, si tiene *Privilege Separation*).

## Licencia

GPL-2.0-or-later.
