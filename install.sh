#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/label-studio-web-OCDS"
ENV_FILE="label-studio-env.yml"
MINICONDA_DIR="$HOME/miniconda3"
MINICONDA_INSTALLER="/tmp/Miniconda3-latest-Linux-x86_64.sh"
MINICONDA_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"

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

install_miniconda() {
    if [[ -d "$MINICONDA_DIR" ]]; then
        print_info "Miniconda already installed at $MINICONDA_DIR"
    else
        print_info "Downloading Miniconda installer..."
        wget -O "$MINICONDA_INSTALLER" "$MINICONDA_URL"
        print_info "Installing Miniconda..."
        bash "$MINICONDA_INSTALLER" -b -p "$MINICONDA_DIR"
        rm -f "$MINICONDA_INSTALLER"
        print_info "Miniconda installed."

        # Initialize conda for bash shell
        eval "$("$MINICONDA_DIR/bin/conda" shell.bash hook)"
        conda init bash

        print_info "Please restart your shell or run 'source ~/.bashrc' to enable conda."
    fi
}

create_conda_env() {

    local env_name
    env_name=$(awk '/^name:/ {print $2; exit}' "$ENV_FILE")

    if conda env list | grep -qE "^${env_name}[[:space:]]"; then
        print_info "Conda environment '$env_name' already exists."
    else
        print_info "Creating conda environment '$env_name' from $ENV_FILE..."
        if [[ ! -f "$ENV_FILE" ]]; then
            print_error "Environment file '$ENV_FILE' not found. Cannot create conda environment."
            exit 1
        fi
        conda env create -f "$ENV_FILE"
        print_info "Conda environment '$env_name' created."
    fi

    print_info "Activating conda environment '$env_name'..."
    # Activate conda environment in script
    # Note: This works if the conda shell hook is loaded.
    eval "$(conda shell.bash hook)"
    conda activate "$env_name"
}

clone_repo() {
    if [[ -d "$REPO_DIR" ]]; then
        print_info "Repository already cloned at $REPO_DIR"
    else
        print_info "Cloning repository..."
        git clone https://github.com/AlexanderStone-DFO/label-studio-web-OCDS.git "$REPO_DIR"
    fi
}

install_poetry_and_dependencies() {
    cd "$REPO_DIR"

    print_info "Installing Poetry..."
    pip install --upgrade poetry

    print_info "Installing Python dependencies via Poetry..."
    poetry install --no-interaction --no-ansi
}

install_node_and_yarn() {
    # Load nvm if available
    if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
        print_info "Loading nvm..."
        # shellcheck source=/dev/null
        source "$HOME/.nvm/nvm.sh"
        nvm use 18 || nvm install 18
    else
        print_warn "nvm not found; ensure Node.js and Yarn are installed manually."
    fi

    cd "$REPO_DIR/web"

    print_info "Installing yarn dependencies..."
    yarn install

    print_info "Building frontend assets..."
    yarn build

    cd "$REPO_DIR"
}

run_django_migrations() {
    cd "$REPO_DIR/label_studio"

    print_info "Running Django migrations..."
    python manage.py migrate

    print_info "Collecting static files..."
    python manage.py collectstatic --noinput

    cd "$REPO_DIR"
}


generate_nginx_conf() {
    local template_path="$REPO_DIR/nginx.conf.template"
    local output_path="$REPO_DIR/nginx/conf/nginx.conf"

    if ! command -v envsubst &>/dev/null; then
        print_warn "envsubst not found, installing gettext..."
        sudo apt-get update && sudo apt-get install -y gettext
    fi

    if [[ ! -f "$template_path" ]]; then
        print_error "Nginx template '$template_path' not found. Skipping nginx config generation."
        return 1
    fi

    export PROJECT_ROOT="$REPO_DIR"

    print_info "Generating nginx config from template at $template_path..."

    mkdir -p "$(dirname "$output_path")"

    # Only substitute ${PROJECT_ROOT}, leave all other $FOO variables intact
    envsubst '${PROJECT_ROOT}' < "$template_path" > "$output_path"

    print_info "Nginx config generated at $output_path"
}


main() {
    #install_miniconda
    #create_conda_env
    #clone_repo  #repo should already be cloned, thats where install comes from
    #install_poetry_and_dependencies
    #install_node_and_yarn
    #run_django_migrations
    generate_nginx_conf

    print_info "Installation complete!"
    print_info "Remember to restart your shell or run 'source ~/.bashrc' to activate conda properly."
}

main "$@"
