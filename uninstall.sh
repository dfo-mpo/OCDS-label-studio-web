#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/label-studio-web-OCDS"
ENV_FILE="label-studio-env.yml"
MINICONDA_DIR="$HOME/miniconda3"

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

remove_conda_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        print_warn "Environment file '$ENV_FILE' not found. Skipping conda environment removal."
        return
    fi
    local env_name
    env_name=$(awk '/^name:/ {print $2; exit}' "$ENV_FILE")

    if conda env list | grep -qE "^${env_name}[[:space:]]"; then
        print_info "Removing conda environment '$env_name'..."
        conda env remove -n "$env_name" -y
        print_info "Conda environment '$env_name' removed."
    else
        print_warn "Conda environment '$env_name' does not exist."
    fi
}

cleanup_poetry_and_yarn() {
    if [[ ! -d "$REPO_DIR" ]]; then
        print_warn "Project directory $REPO_DIR does not exist; skipping Poetry and Yarn cleanup."
        return
    fi

    # Remove Poetry .venv folder if present (optional)
    if [[ -d "$REPO_DIR/.venv" ]]; then
        print_info "Removing Poetry virtual environment directory at $REPO_DIR/.venv ..."
        rm -rf "$REPO_DIR/.venv"
        print_info "Removed Poetry virtual environment directory."
    else
        print_info "No Poetry .venv directory found in $REPO_DIR."
    fi

    # Remove Yarn node_modules and build directories in web/
    local web_dir="$REPO_DIR/web"
    if [[ -d "$web_dir/node_modules" ]]; then
        print_info "Removing Yarn node_modules directory at $web_dir/node_modules ..."
        rm -rf "$web_dir/node_modules"
        print_info "Removed node_modules."
    else
        print_info "No node_modules directory found in $web_dir."
    fi

    for build_dir in build dist; do
        if [[ -d "$web_dir/$build_dir" ]]; then
            print_info "Removing Yarn build directory at $web_dir/$build_dir ..."
            rm -rf "$web_dir/$build_dir"
            print_info "Removed $build_dir."
        fi
    done
}

remove_miniconda() {
    if [[ -d "$MINICONDA_DIR" ]]; then
        print_warn "Removing Miniconda installation at $MINICONDA_DIR ..."
        rm -rf "$MINICONDA_DIR"
        print_info "Miniconda directory removed."

        if [[ -d "$HOME/.conda" ]]; then
            print_info "Removing conda config directory ~/.conda ..."
            rm -rf "$HOME/.conda"
        fi

        if [[ -d "$HOME/.continuum" ]]; then
            print_info "Removing continuum config directory ~/.continuum ..."
            rm -rf "$HOME/.continuum"
        fi

        print_warn "Please manually remove any conda initialization lines from your shell startup files (~/.bashrc, ~/.zshrc, etc.) to complete uninstall."
    else
        print_warn "Miniconda installation not found at $MINICONDA_DIR. Skipping Miniconda removal."
    fi
}

check_git_changes() {
    if [[ ! -d "$REPO_DIR/.git" ]]; then
        print_warn "No git repository found in $REPO_DIR; skipping unsaved changes check."
        return 0
    fi

    if ! git -C "$REPO_DIR" diff --quiet || \
       ! git -C "$REPO_DIR" diff --cached --quiet || \
       [[ -n "$(git -C "$REPO_DIR" ls-files --others --exclude-standard)" ]]; then
        print_warn "WARNING: Uncommitted changes or untracked files detected in $REPO_DIR."
        print_warn "Uninstall will delete these changes permanently."
        if ! confirm "Proceed anyway?"; then
            print_info "Uninstall aborted due to unsaved changes."
            exit 1
        fi
    else
        print_info "No unsaved changes detected in the git repository."
    fi
}

remove_poetry() {
    if command -v pip >/dev/null 2>&1 && pip show poetry >/dev/null 2>&1; then
        print_warn "Uninstalling Poetry via pip..."
        pip uninstall -y poetry && print_info "Poetry uninstalled." || print_warn "Failed to uninstall Poetry."
    else
        print_info "Poetry not found via pip, skipping uninstall."
    fi
}

remove_yarn() {
    if command -v yarn >/dev/null 2>&1; then
        print_warn "Uninstalling Yarn via npm..."
        if command -v npm >/dev/null 2>&1; then
            if npm uninstall -g yarn; then
                print_info "Yarn uninstalled."
            else
                print_warn "npm failed to uninstall Yarn. Please uninstall manually."
            fi
        else
            print_warn "npm not found; cannot uninstall Yarn automatically."
        fi
    else
        print_info "Yarn not found, skipping uninstall."
    fi
}

main() {
    print_warn "This will fully uninstall label-studio-web-OCDS, conda environment, Miniconda, Poetry, and Yarn."
    if ! confirm "Proceed with FULL uninstall?"; then
        print_info "Uninstall aborted."
        exit 0
    fi

    if [[ -x "$MINICONDA_DIR/bin/conda" ]]; then
        # shellcheck disable=SC1090
        source "$MINICONDA_DIR/etc/profile.d/conda.sh"
    fi

    remove_conda_env
    cleanup_poetry_and_yarn

    check_git_changes

    remove_miniconda

    remove_poetry
    remove_yarn

    if [[ -d "$REPO_DIR" ]]; then
        print_info "Removing project directory at $REPO_DIR last..."
        rm -rf "$REPO_DIR"
        print_info "Project directory removed."
    else
        print_warn "Project directory $REPO_DIR does not exist."
    fi

    print_info "Full uninstall complete."
}

main "$@"
