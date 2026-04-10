# Label Studio (OCDS) – System Documentation

This document describes the architecture, operation, and key implementation details of the customized Label Studio deployment built by OCDS.

---

## Table of Contents

1. System Overview
2. Running the Application
3. System Architecture
4. Image Conversion (Deep Zoom)
5. Creating a HugeImage Project
6. Development Notes
7. Known Issues

---

## 1. System Overview

This deployment of Label Studio consists of three primary components:

* **NGINX** – Entry point and reverse proxy
* **Frontend (React + Webpack)** – User interface
* **Backend (Django + uWSGI)** – Application logic and data handling

Additionally, the system includes a utility for converting large images into a tiled format compatible with OpenSeadragon.

---

## 2. Running the Application

A helper script, `start.sh`, is used to manage all services. This script abstracts most operational complexity and should be the primary interface for starting, stopping, and maintaining the system, including image conversion (see [Image Conversion](#4-image-conversion-deep-zoom)).

Note that all start modes spawn multiple processes. `Ctrl+C` will only stop the webpack process — other processes will continue running. Always use `./start.sh stop` to fully shut down.

---

### Production Mode

```bash
./start.sh
```

This starts:

* NGINX
* Backend (via uWSGI)
* Serves pre-built frontend assets

---

### Development Modes

#### Full Development Environment

```bash
./start.sh front-dev
```

This starts:

* NGINX
* Backend
* Frontend development server (yarn dev)

Hot Module Replacement (HMR) is enabled, allowing frontend changes to be reflected without restarting the server.

Initial startup will take time due to frontend compilation. When the build is ready, you will see:

```
chunk (runtime: runtime) vendor.js (vendor) (id hint: commonVendor) 1.65 MiB [initial] split chunk (cache group: commonVendor) (name: vendor)
webpack compiled successfully (e76cbaa5240e788b)
```

If you see errors like `ERR port in use`, parts of the server are likely already running. Run `./start.sh stop` to clear them. `front-dev` runs this automatically, but manual intervention may still be needed.

---

#### Backend Debugging Mode

```bash
./start.sh back-dev
```

This starts:

* NGINX
* Frontend development server

The backend is **not started**, allowing it to be launched manually through VS Code using `.vscode/launch.json` (included in the repo). This mode does not run the initial kill step that `front-dev` does.

Once `back-dev` is running, open `label_studio.py` in VS Code and run it via the launch config. The launch config sets environment variables that tell the backend to expect a running frontend dev server — see [Frontend Configuration](#configuration) for details.

---

### Stopping Services

```bash
./start.sh stop
```

`Ctrl+C` will only stop the process connected to the terminal, which is usually the webpack server. To stop all services including the backend and NGINX, use `./start.sh stop`.

---

### Rebuilding the Frontend

```bash
./start.sh build
```

Run this after making frontend changes you want to deploy in production. Compilation typically takes around 10 minutes. Output is written to:

```
label_studio/core/static_build/
```

It is not necessary to delete the static assets before running the build. The command will overwrite them.

After building, start the server with:

```bash
./start.sh
```

**Note on caching:** After a rebuild, requests may be served from a cache and return stale assets. See [Known Issues – Static Asset Caching](#static-asset-caching).

---

## 3. System Architecture

### 3.1 NGINX (Entry Point)

NGINX serves as the external interface to the system.
It takes in the requests from the user, and routes them to the correct destination. It will send the frontend app, the dzi files, the API for server requests, and a few other requests as requested.

* Default port: **8080**
* Configuration file: `/nginx/conf/nginx.conf`
* Generated from: `/nginx/conf/nginx.conf.template` when nginx is started via `start.sh`

#### Routing Behavior

The following is a simplified snippet from the config, showing the key routing rules:

```nginx
location /dzi/ {
    alias /home/azureuser/label-studio-web-OCDS/dzi/;
    autoindex off;
}

location / {
    absolute_redirect off;
    send_timeout 90;
    proxy_pass http://127.0.0.1:8000/;
}
```

Requests to `/dzi/` are served directly from the folder on disk where the deep zoomable images are stored. Any request that doesn't match a more specific rule is forwarded to the backend server at port 8000.

---

### 3.2 Backend (Django + uWSGI)

The backend handles the data and logic side of the application. Django processes incoming requests — things like saving annotations, retrieving tasks, uploading files, and logging in. It stores and retrieves information via a SQLite3 database.

#### Runtime

* Development: Django development server (plain Python)
* Production: `uWSGI` (handles threads, timeouts, and other production concerns)

#### Port

* Runs on `127.0.0.1:8000`

#### Database

The SQLite database is typically located at:

```bash
sqlite3 ../.local/share/label-studio/label_studio.sqlite3
```

The database stores projects, tasks, annotations, users, and more. Deletion of this file would result in loss of data. Backing up just this file should be sufficient to backup all the data in the system, except for the actual uploaded images, which will also be in the share/label-studio folder.(configurable)

Direct interaction with the database is **not required for normal operation**. It is primarily useful for debugging, inspecting corrupted data, backups, or manual recovery.

---

### 3.3 Frontend (React + Webpack)

The frontend is a React application bundled with Webpack via yarn.

#### Development Mode

* Runs on: `http://localhost:8010`
* Supports Hot Module Replacement (HMR)

#### Production Mode

* Compiled into static assets
* Served via NGINX directly (no frontend server running)

#### Configuration

Depending on how the environment variables are set, it may be served in different ways.
Here is an example from `.vscode/launch.json`:
```json
"env": {
    "PYTHONPATH": "${workspaceFolder}",
    "FRONTEND_HMR": "true",
    "FRONTEND_HOSTNAME": "http://localhost:8010"
}
```

* If `FRONTEND_HOSTNAME` is set to an address, the backend expects a running frontend dev server at that address and will not serve static files
* If `FRONTEND_HOSTNAME` is empty (`""`), the backend serves the static build directly, even if FRONTEND_HMR is set to true

When using `back-dev` or `front-dev`, this config is what causes the system to rely on the yarn dev server rather than pre-built assets.

---

## 4. Image Conversion (Deep Zoom)

Large images must be converted into Deep Zoom Image (DZI) format before use. DZI is a tiled image format that allows OpenSeadragon to efficiently render huge images by only loading the tiles needed for the current zoom level and viewport.

It works by splitting up the images into a index file, and a collection of nested folders with different resolution tiles. The OpenSeaDragon renderer used in the frontend will automatically request the correct tiles to achieve a seamless viewing experience. 

The conversion of images to DZI is handled by a single script: `convert_to_dzi.py` which can be called by start.sh for convenience.

### Usage

```bash
./start.sh convert
```

`start.sh` passes any additional arguments directly to `convert_to_dzi.py`. Check that file for the full option set.

By default is has the input directory set to `hugeimages/`, and the output directory set to `dzi/`.

The input argument is the first argument (positional)
The output argument is specified by the `--output` flag

If an image in the input folder has already been converted and placed in the output direectory, it will be skipped.

---

### Options

Force reconversion of all images, even if a DZI already exists:

```bash
./start.sh convert --force
```

Delete all existing DZIs without converting anything:

```bash
./start.sh convert --clear
```

---

### Integration

Converted images are served directly by NGINX under `/dzi/`. No backend/django involvement is required once conversion is complete.

---

## 5. Creating a HugeImage Project

### Workflow

I recommend converting the large images to lossy jpeg first, in our use case this turned 1.5GB images to around 100MB images, while still being able to identify the roughly 100px by 100px objects clearly. Note that your browser will still not be able to render the 100MB jpeg, because that 100MB file will get uncompressed and displayed at the original resolution to show it on the screen.

1. Download images onto the server and place them in:

```
hugeimages/
```

2. Convert them:

```bash
./start.sh convert
```

3. In Label Studio, create a new project and select the **HugeImage** template.

4. This should redirect to the config page. Switch from **View** to **Code** mode to directly edit the configuration XML. Labels, colors, default annotation size, and other properties can be modified here.

5. You can create the project immediately and import data later, or go to **Import Data** first.

---

### Important: File Import

It is strongly recommended to import the **original image files**, not placeholder files.

Reasons:

* Prevents filename mismatches that could cause images to not be found
* Ensures ML backends receive correct data when asked for predictions. The ML backend server is sent whatever file was originally imported, so if a placeholder was used, that placeholder is what the ML backend receives.

---

## 6. Development Notes

### Key Files

#### HugeImage Implementation

```
web/libs/editor/src/tags/object/HugeImage/
  ├── HugeImageView.jsx
  └── HugeImageModel.jsx
```

#### Base Image Implementation

```
web/libs/editor/src/tags/object/Image/Image.js
```

---

### Architectural Note: HugeImageModel Inheritance

`HugeImageModel` currently inherits from the standard `Image` implementation and overrides behavior as needed. This approach is fragile. A more maintainable design would avoid inheriting from Image entirely and instead reuse the same mixins that `Image.js` uses directly. Mixins are JavaScript's approach to multiple inheritance, and building from them rather than from Image would likely offer some readability improvements. Note that there is also a ImageEntity.js class, which complicates this approach a bit.

---

### OpenSeadragon Event Handling

OpenSeadragon (OSD) intercepts most mouse events (everything except mouse move), and does not give those events to the object originally clicked on. This causes issues with:

* Click handling on the stage
* Click-and-drag on annotated objects
* Annotation tool interactions

#### Current Workaround

Events captured by OSD are manually re-dispatched to the appropriate handlers.

#### Debugging Guidance

If UI interactions behave unexpectedly — particularly anything involving click, drag, or selection — assume OSD is intercepting events and inspect event propagation carefully before looking elsewhere.

For instance click and drag is a feature offered by javascript at a more fundamental level, using global event listeners. OSD intercepts these, so click and drag behaves very weirdly. The fix was to manually send a global click event inside the event listener for OSD. 
Similarly for the stage, we check if the cursor is over a stage object, and if its found we send the event to the object directly.

---

### Modifying Columns

Label Studio uses the term "regions" for bounding boxes and "annotations" for an annotator's full set of regions on an image. You could consider an annotation as an annotators opinion of the regions on an image. This feature is designed for averaging multiple annotators outputs on an image to reduce noise. A request was made for a column that measured number of regions, so a column was added to show the average regions per annotation.

Adding a new column requires two steps: writing a database queryset to populate it, and adding the column definition itself. 
An incomplete list of relevant files:
`label-studio-web-OCDS/label_studio/data_manager/functions.py`
`label-studio-web-OCDS/label_studio/data_manager/serializers.py`

---

## 7. Known Issues

### Preview Annotation Failure

* Cannot draw annotations on preview images
* Likely caused by incorrect image dimensions being passed to the preview renderer
* When it was a hardcoded image in the /dzi folder it worked, but that is a bit big to fit in the repo, and that file is restricted access.

---

### COCO Import Issues

* Imported COCO data is malformed in some way
* Exporting and re-importing does not resolve it
* Possible workaround: use the Label Studio SDK for conversion prior to import
* There is code in the data import part to add some coco functionality
`label-studio-web-OCDS/label_studio/data_import/models.py`
Its purpose was to import a coco annotation, and from that automatically generate the config for the task, and show it to the user in a modal.

---

### Project Deletion Crash

* Occurs when deleting the last task in a project
* Produces a red error screen but does not appear to cause further damage
* Likely caused by a sequencing issue in the deletion order (tasks → annotations → project)
* May be triggered specifically by projects with corrupted COCO-imported data

---

### Two-Click Annotation Disabled

File:

```
web/libs/editor/src/mixins/DrawingTool.js
```

The two-point click-to-draw annotation feature was intentionally disabled by making the relevant click handler return immediately. When enabled, it causes a crash. The suspected cause is that an in-progress annotation is being rendered in the wrong parent context. The exact cause was not able to be determined. It was a good feature but the crash message is very unclear as to what actually happens. It is only disabled / crashes for HugeImage projects.

---

### Static Asset Caching

After running `./start.sh build`, requests may be intercepted by an unidentified caching mechanism and return stale assets instead of the newly built ones. The source of this caching has not been identified. It is not NGINX, the browser cache, or the VM itself.

* Not resolved by resetting browser caches, restarting the machine, or restarting the VM
* Appears to resolve on its own after roughly a day
* The browsers support a cache=false flag, there is a small chance this would help if the network also supported the flag. Its possible that this could be attached to the responses at the nginx config file.

---