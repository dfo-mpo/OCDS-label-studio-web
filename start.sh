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

# Define relative paths
LABEL_STUDIO_DIR="$REPO_ROOT/label_studio"
NGINX_CONFIG="$REPO_ROOT/nginx/conf/nginx.conf"
NGINX_LOG_DIR="$REPO_ROOT/nginx/logs"
UWSGI_PID_FILE="/tmp/labelstudio_uwsgi.pid"
NGINX_PID_FILE="$NGINX_LOG_DIR/nginx.pid"

UWSGI_PORT=8000
NGINX_PORT=8080

# Export environment variables needed by Django/Label Studio
export DJANGO_SETTINGS_MODULE=core.settings.label_studio
export LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true

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
        print_warning "Force killing process on port $UWSGI_PORT"
        lsof -ti:$UWSGI_PORT | xargs kill -9 2>/dev/null || true
    fi

    if check_port $NGINX_PORT; then
        print_warning "Force killing process on port $NGINX_PORT"
        lsof -ti:$NGINX_PORT | xargs kill -9 2>/dev/null || true
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
    echo "  help      Show this help message"
    echo
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

# Main execution
case "${1:-start}" in
    start)
        print_status "Starting Label Studio services..."
        stop_services
        start_uwsgi
        start_nginx
        check_health
        show_status
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
        start_nginx
        check_health
        show_status
        print_success "Label Studio restarted successfully!"
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
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac