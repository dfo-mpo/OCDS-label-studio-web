#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/label-studio-web-OCDS"
ENV_FILE="$HOME/label-studio-env.yml"

print_info() {
    printf '\033[1;34m[INFO]\033[0m %s\n' "$*"
}

print_warn() {
    printf '\033[1;33m[WARN]\033[0m %s\n' "$*"
}

print_error() {
    printf '\033[1;31m[ERROR]\033[0m %s\n' "$*"
}

confirm() {
    local prompt default reply
    prompt="${1:-Are you sure?} [y/N]: "
    default="${2:-N}"
    while true; do
        printf '%s' "$prompt"
        read -r reply
        reply="${reply:-$default}"
        case "$reply" in
            [Yy]*) return 0 ;;
            [Nn]*) return 1 ;;
            *) printf 'Please answer y or n.\n' ;;
        esac
    done
}

remove_repo() {
    if [[ -d "$REPO_DIR" ]]; then
        print_info "Found repository at $REPO_DIR"
        cd "$REPO_DIR"
        if [[ -n $(git status --porcelain) ]]; then
            print_warn "Uncommitted changes detected in the repository."
            if confirm "Delete repository and all changes?"; then
                rm -rf "$REPO_DIR"
                print_info "Repository deleted."
            else
                print_warn "Aborting uninstall to preserve your changes."
                exit 1
            fi
        else
            rm -rf "$REPO_DIR"
            print_info "Repository deleted."
        fi
    else
        print_info "Repository directory not found; skipping."
    fi
}

remove_conda_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        print_warn "Conda environment file $ENV_FILE not found; skipping environment removal."
        return
    fi

    local env_name
    env_name=$(awk '/^name:/ {print $2; exit}' "$ENV_FILE")

    if conda env list | grep -qE "^${env_name}[[:space:]]"; then
        print_info "Removing conda environment: $env_name"
        conda env remove -n "$env_name"
        print_info "Conda environment removed."
    else
        print_info "Conda environment '$env_name' not found; skipping."
    fi
}

print_info "Starting uninstallation..."

remove_repo
remove_conda_env

print_warn "Miniconda installation is NOT removed by this script. Please remove it manually if desired."

print_info "Uninstallation complete!"
