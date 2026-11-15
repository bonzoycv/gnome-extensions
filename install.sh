#!/usr/bin/env bash
# Instala las extensiones de este repositorio en ~/.local/share/gnome-shell/extensions/.
#
# Uso:
#   ./install.sh                 instala todas (copia)
#   ./install.sh --link          enlaza en vez de copiar (para desarrollar: los cambios del repo se usan directo)
#   ./install.sh pc-monitor      instala solo las que coincidan con el nombre
#
# Si ya existe una carpeta instalada (no enlace), se mueve a ~/.cache/gnome-extensions-backup/.
# En Wayland, los cambios se ven al cerrar sesión y volver a entrar.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
BACKUP="${XDG_CACHE_HOME:-$HOME/.cache}/gnome-extensions-backup"
MODE=copy
FILTERS=()

for arg in "$@"; do
    case "$arg" in
        --link) MODE=link ;;
        --copy) MODE=copy ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) FILTERS+=("$arg") ;;
    esac
done

mkdir -p "$DEST"

for src in "$REPO"/*@*/; do
    src="${src%/}"
    uuid="$(basename "$src")"
    [[ -f "$src/metadata.json" ]] || continue

    if ((${#FILTERS[@]})); then
        match=0
        for f in "${FILTERS[@]}"; do [[ "$uuid" == *"$f"* ]] && match=1; done
        ((match)) || continue
    fi

    if [[ -d "$src/schemas" ]]; then
        glib-compile-schemas --strict "$src/schemas"
    fi

    target="$DEST/$uuid"
    if [[ -L "$target" ]]; then
        rm "$target"
    elif [[ -e "$target" ]]; then
        mkdir -p "$BACKUP"
        chmod 700 "$BACKUP"
        stamp="$(date +%Y%m%d-%H%M%S)"
        mv "$target" "$BACKUP/$uuid.$stamp"
        echo "  copia de la versión anterior: $BACKUP/$uuid.$stamp"
    fi

    if [[ "$MODE" == link ]]; then
        ln -s "$src" "$target"
        echo "✔ $uuid enlazada"
    else
        mkdir -p "$target"
        cp -r "$src"/. "$target"/
        rm -f "$target/README.md"
        echo "✔ $uuid copiada"
    fi

    gnome-extensions enable "$uuid" 2>/dev/null || true
done

echo
echo "Listo. En Wayland cierra sesión y vuelve a entrar para cargar los cambios."
