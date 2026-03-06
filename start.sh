#!/bin/bash

# Label Studio Startup Script
# This script starts the uwsgi server and nginx in the correct order using relative paths

# Function to print colored output (simple here, no colors for now)
print_status() {
    echo "[INFO] $1"
}

print_success() {
    echo "[SUCCESS] $1"
}

print_warning() {
    echo "[WARNING] $1"
}

print_error() {
    echo "[ERROR] $1"
}
# Load conda into script environment and activate the correct environment
if [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
    source "$HOME/miniconda3/etc/profile.d/conda.sh"
    
    conda activate label-studio  # replace with your actual env name if different
    print_status "Activated conda environment: $(conda info --envs | grep '^label-studio')"
else
    print_error "Conda not found at expected path. Make sure Miniconda is installed."
    exit 1
fi

if [[ "$CONDA_DEFAULT_ENV" != "label-studio" ]]; then
    print_error "Conda environment activation failed. Expected: label-studio, got: $CONDA_DEFAULT_ENV"
    echo "which python: $(which python)"
    exit 1
fi


# Resolve the directory this script lives in (absolute path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Assume repo root is parent directory of script directory; adjust if different
REPO_ROOT="$(cd "$SCRIPT_DIR/" && pwd)"

echo "REPO ROOT: $REPO_ROOT"

#screen name, for terminal reconnection
SCREEN_NAME="label-studio-screen"

# Define relative paths
LABEL_STUDIO_DIR="$REPO_ROOT/label_studio"
NGINX_CONFIG="$REPO_ROOT/nginx/conf/nginx.conf"
NGINX_LOG_DIR="$REPO_ROOT/nginx/logs"
UWSGI_PID_FILE="/tmp/labelstudio_uwsgi.pid"
NGINX_PID_FILE="$NGINX_LOG_DIR/nginx.pid"

UWSGI_PORT=8000
NGINX_PORT=8080
FRONT_PORT=8010

# Export environment variables needed by Django/Label Studio
export DJANGO_SETTINGS_MODULE=core.settings.label_studio
export LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true
export FRONTEND_HMR=false
export FRONTEND_HOSTNAME=""
export LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT=/data/

# if FRONTEND_HOSTNAME is defined it automatically looks for it there instead of static
# and if HMR is true then it refreshes or looks for changes? its not enable and arg if enabled, its enable HMR and override frontend path

set -e  # Exit on any error


# Check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Stop existing services if running
stop_services() {
    print_status "Stopping existing services..."

    # Stop nginx if running
    if [ -f "$NGINX_PID_FILE" ]; then
        local nginx_pid
        nginx_pid=$(cat "$NGINX_PID_FILE" 2>/dev/null || true)
        if [ -n "$nginx_pid" ] && kill -0 "$nginx_pid" 2>/dev/null; then
            print_status "Stopping nginx (PID: $nginx_pid)..."
            kill "$nginx_pid"
            sleep 2
        fi
    fi

    # Stop uwsgi if running
    if [ -f "$UWSGI_PID_FILE" ]; then
        local uwsgi_pid
        uwsgi_pid=$(cat "$UWSGI_PID_FILE" 2>/dev/null || true)
        if [ -n "$uwsgi_pid" ] && kill -0 "$uwsgi_pid" 2>/dev/null; then
            print_status "Stopping uwsgi (PID: $uwsgi_pid)..."
            kill "$uwsgi_pid"
            sleep 2
        fi
    fi

    # Force kill any processes still using the ports
    if check_port $UWSGI_PORT; then
        print_warning "Force killing process on uwsgi port $UWSGI_PORT"
        lsof -ti:$UWSGI_PORT | xargs kill -9 2>/dev/null || true
    else
        echo "uwsgi port $UWSGI_PORT is free"
    fi

    if check_port $NGINX_PORT; then
        print_warning "Force killing process on nginx port $NGINX_PORT"
        lsof -ti:$NGINX_PORT | xargs kill -9 2>/dev/null || true
    else
        echo "nginx port $NGINX_PORT is free"
    fi

    if check_port $FRONT_PORT; then
        print_warning "Force killing process on frontdev port $FRONT_PORT"
        lsof -ti:$FRONT_PORT | xargs kill -9 2>/dev/null || true
    else
        echo "frontdev port $FRONT_PORT is free"
    fi

}

# Start uwsgi server
start_uwsgi() {
    print_status "Starting uwsgi server on port $UWSGI_PORT..."

    cd "$LABEL_STUDIO_DIR" || { print_error "Label Studio directory not found: $LABEL_STUDIO_DIR"; exit 1; }

    # Start uwsgi in background with poetry environment
    poetry run uwsgi \
        --http 127.0.0.1:$UWSGI_PORT \
        --chdir=$(pwd) \
        --module=core.wsgi:application \
        --processes 4 \
        --threads 2 \
        --pidfile=$UWSGI_PID_FILE \
        --daemonize=/tmp/labelstudio_uwsgi.log &

    sleep 3

    if check_port $UWSGI_PORT; then
        print_success "uwsgi server started successfully on port $UWSGI_PORT"
    else
        print_error "Failed to start uwsgi server"
        exit 1
    fi
}

# Start nginx server
start_nginx() {
    print_status "Starting nginx on port $NGINX_PORT with config: $NGINX_CONFIG"

    # Test nginx config
    if ! nginx -t -c "$NGINX_CONFIG" >/dev/null 2>&1; then
        print_error "nginx configuration test failed"
        nginx -t -c "$NGINX_CONFIG"
        exit 1
    fi

    # Start nginx
    nginx -c "$NGINX_CONFIG"

    sleep 2

    if check_port $NGINX_PORT; then
        print_success "nginx started successfully on port $NGINX_PORT with config: $NGINX_CONFIG"
    else
        print_error "Failed to start nginx"
        exit 1
    fi
}

# Check health of services
check_health() {
    print_status "Checking service health..."

    if curl -s http://127.0.0.1:$UWSGI_PORT/ >/dev/null 2>&1; then
        print_success "uwsgi is responding"
    else
        print_error "uwsgi is not responding"
    fi

    if curl -s http://127.0.0.1:$NGINX_PORT/nginx_health >/dev/null 2>&1; then
        print_success "nginx is responding"
    else
        print_error "nginx is not responding"
    fi

    if curl -s http://127.0.0.1:$NGINX_PORT/ >/dev/null 2>&1; then
        print_success "Full stack is working"
    else
        print_error "Full stack is not responding"
    fi

    
}

# Show status info
show_status() {
    echo
    print_status "=== Label Studio Status ==="
    echo "uwsgi server: http://127.0.0.1:$UWSGI_PORT (internal)"
    echo "nginx proxy:  http://127.0.0.1:$NGINX_PORT (public)"
    echo
    echo "PID files:"
    echo "  uwsgi: $UWSGI_PID_FILE"
    echo "  nginx: $NGINX_PID_FILE"
    echo
    echo "Log files:"
    echo "  uwsgi: /tmp/labelstudio_uwsgi.log"
    echo "  nginx access: $NGINX_LOG_DIR/access.log"
    echo "  nginx error:  $NGINX_LOG_DIR/error.log"
    echo
}

# Show help message
show_help() {
    echo "Usage: $0 [COMMAND]"
    echo
    echo "Commands:"
    echo "  start     Start Label Studio services (default)"
    echo "  stop      Stop Label Studio services"
    echo "  restart   Restart Label Studio services"
    echo "  status    Show service status"
    echo "  health    Check service health"
    echo "  logs      Show recent logs"
    echo "  front-dev Run frontend development server with yarn dev"
    echo "  help      Show this help message"
    echo
    echo "  convert [force|clear]"
    echo "           Convert images in ./hugeimages to DZI format in ./dzi"
    echo "           force = reconvert all images"
    echo "           clear = delete all DZI outputs"
}

# Show recent logs
show_logs() {
    echo
    print_status "=== Recent uwsgi logs ==="
    tail -n 20 /tmp/labelstudio_uwsgi.log 2>/dev/null || echo "No uwsgi logs found"

    echo
    print_status "=== Recent nginx error logs ==="
    tail -n 20 "$NGINX_LOG_DIR/error.log" 2>/dev/null || echo "No nginx error logs found"

    echo
    print_status "=== Recent nginx access logs ==="
    tail -n 10 "$NGINX_LOG_DIR/access.log" 2>/dev/null || echo "No nginx access logs found"
    echo
}



generate_nginx_conf() {
    local template_path="$REPO_ROOT/nginx.conf.template"
    local output_path="$REPO_ROOT/nginx/conf/nginx.conf"

    print_status "Removing old nginx.conf if it exists..."
    rm -f "$output_path"

    if ! command -v envsubst &>/dev/null; then
        print_warning "envsubst not found, attempting to install gettext..."
        sudo apt-get update && sudo apt-get install -y gettext
    fi

    if [[ ! -f "$template_path" ]]; then
        print_error "Nginx template '$template_path' not found. Skipping nginx config generation."
        return 1
    fi

    export PROJECT_ROOT="$REPO_ROOT"

    print_status "Generating nginx config from template at $template_path..."
    mkdir -p "$(dirname "$output_path")"

    # Only substitute ${PROJECT_ROOT}
    envsubst '${PROJECT_ROOT}' < "$template_path" > "$output_path"

    print_success "Nginx config generated at $output_path"
}

# create_screen_session() {
#     # Check if a screen with this name already exists
#     local EXISTING_SCREEN
#     EXISTING_SCREEN=$(screen -ls | grep -w "$SCREEN_NAME" || true)
#     if [ -n "$EXISTING_SCREEN" ]; then
#         print_warning "Existing screen '$SCREEN_NAME' detected. Shutting it down..."
#         screen -S "$SCREEN_NAME" -X quit
#         sleep 1
#     fi

#     # Launch a new interactive screen
#     screen -S "$SCREEN_NAME"

#     print_status "Screen created: $SCREEN_NAME. Terminal session can now be reconnected later with: screen -r $SCREEN_NAME"
# }

# Main execution
case "${1:-start}" in
    start)

        # create_screen_session

        generate_nginx_conf

        print_status "Starting Label Studio services..."
        stop_services
        start_uwsgi
        start_nginx
        check_health
        show_status
        print_success "Label Studio is now running!"
        ;;

    convert)
        # Remove the first argument ("convert") so we only pass the rest
        shift
        python3 "$REPO_ROOT/convert_to_dzi.py" "$@"
        ;;
        
    back-dev)
        print_status "Starting backend development server..."
    
        export LOG_LEVEL=DEBUG
        export DJANGO_LOG_LEVEL=DEBUG

        export FRONTEND_HMR=true
        export FRONTEND_HOSTNAME=http://localhost:8010
        cd ~/label-studio-web-OCDS/web
        yarn dev &

        generate_nginx_conf
        #start_uwsgi    this has to be done by VS code in debug mode
        start_nginx        
        check_health

        #cd "$LABEL_STUDIO_DIR" || { print_error "Label Studio directory not found: $LABEL_STUDIO_DIR"; exit 1; }
        #poetry run python manage.py runserver
        ;;
    front-dev)
    
        # create_screen_session

        print_status "Starting frontend development server..."
        stop_services

        print_warning "Logger level set to DEBUG"
        export LOG_LEVEL=DEBUG
        export DJANGO_LOG_LEVEL=DEBUG

        export FRONTEND_HMR=true
        export FRONTEND_HOSTNAME=""

        cd "$REPO_ROOT/web" || { print_error "web directory not found: $REPO_ROOT/web"; exit 1; }
        yarn dev &

        # Save yarn dev PID in case you want to kill it later (optional)
        YARN_PID=$!

        print_status "Frontend dev server started with PID $YARN_PID"

        # Go back to repo root and start backend normally
        cd "$REPO_ROOT" || { print_error "Failed to cd back to repo root"; exit 1; }
        # Start backend services normally
        echo
        echo
        print_status "Please connect to localhost:$FRONT_PORT via local port forwarding to access the frontend-dev server"
        print_status "Please connect to localhost:$FRONT_PORT via local port forwarding to access the frontend-dev server"
        print_status "Please connect to localhost:$FRONT_PORT via local port forwarding to access the frontend-dev server"
        print_status "Please connect to localhost:$FRONT_PORT via local port forwarding to access the frontend-dev server"
        print_status "Front-dev mode seems to have a memory leak, it will crash after around 5 hours, so please use other modes for production"
        print_status "Webpack will have to build first before you can connect"
        echo
        echo

        print_status "Starting Label Studio services..."
        generate_nginx_conf
        start_uwsgi
        start_nginx        
        check_health
        
        if curl -s http://127.0.0.1:$FRONT_PORT/ >/dev/null 2>&1; then
          print_success "Yarn server is working"
        else
            print_error "Yarn server is not responding"
        fi

        print_success "Label Studio is now running!"

        ;;
    stop)
        print_status "Stopping Label Studio services..."
        stop_services
        
        print_success "Label Studio services stopped"
        ;;
    restart)
        print_status "Restarting Label Studio services..."
        stop_services
        sleep 2
        start_uwsgi

        generate_nginx_conf

        start_nginx
        check_health
        show_status
        print_success "Label Studio restarted successfully!"
        ;;
    build)
        # Build frontend
        cd "$REPO_ROOT/web" || { print_error "Frontend directory not found: $REPO_ROOT/web"; exit 1; }
        
        print_status "Installing frontend dependencies..."
        yarn install --frozen-lockfile
        
        print_status "Building frontend assets..."
        yarn run build
        
        # Collect static files with Django
        cd "$LABEL_STUDIO_DIR" || { print_error "Label Studio directory not found: $LABEL_STUDIO_DIR"; exit 1; }
        
        print_status "Collecting static files with Django..."
        poetry run python manage.py collectstatic --no-input --clear
        
        print_success "Frontend build and static collection completed"
    ;;
    status)
        show_status
        ;;
    health)
        check_health
        ;;
    logs)
        show_logs
        ;;
    help|-h|--help)
        show_help
        ;;
    nginx)

        generate_nginx_conf

        start_nginx
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac