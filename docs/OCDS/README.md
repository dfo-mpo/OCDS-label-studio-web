# Documentation of Label Studio, by OCDS

## This is documentation written by OCDS
## Documenting the procedures and structure of label studio

### General Structure of Label Studio

When label studio is running, there are generally 3 servers.

The first server and the simplest one is NGINX, this is essentially the front door of the server.
When a connection from the internet comes to the server, NGINX is the first to receive it, and it routes it to other servers, or retrieves files as requested.
It is configured by a file called nginx.conf, located in 
/nginx/conf/nginx.conf generated from /nginx/conf/nginx.conf.template on startup
Nginx is configured to run on port 8080.

Here is a simplified sample of the config
```shell
        ...
        # DeepZoom route
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
So here it is sending requests to /dzi/ to the actual folder where the deep zoomable images are held, and it is sending requests that dont match any previous location to the server at port 8000, which is the backend server.

The backend server is written in python, and using the django framework. It handles all of the data part of the website like saving annotations, getting annotations, uploading files, logging in, etc.
It is run by a command called uwsgi, which seems to be a python server for production applications, handling things like threads, timeouts, etc.
The server can be run with regular python instead, but only for development purposes.
The actual data itself is stored in a sqlite3 database, which you can access with
(assuming you are running this in the repo directory, label-studio-web-ocds)
I believe this is configurable, so it may be different on other machines.
```shell 
sqlite3 ../.local/share/label-studio/label_studio.sqlite3
```

Next there is the frontend, which is the actual user interface. This consists of an app written in javascript, and using the React framework. However instead of just serving the frontend files as they are, they are compressed, have their context removed, and turned into a webpack. This is handled by yarn. 
If the server is in development mode, then yarn will be a server at port 8010
which will supply the files actively, and if its in production mode then it will just build the files and they'll be served statically by nginx instead.
The backend has a config for the frontend address, if its blank ("") it serves it statically, otherwise it will be expecting a server.

Snippet from the launch.json showing the environment variables, which makes it require a frontend server.
```shell
    "env": {
    "PYTHONPATH": "${workspaceFolder}",
    "FRONTEND_HMR": "true",
    "FRONTEND_HOSTNAME": "http://localhost:8010"
    }
```

### Starting the servers (And start.sh in general)
We have a shell script called start.sh, with a couple different routes, that tries to automate as much of the process as possible. 

Note that these commands start multiple processes, so when you hit Ctrl+C to stop the process, there will be other processes still running.
To stop them all you can run:
```shell
start.sh stop
```

If you just want to start the server for production, just run:
```shell
start.sh
```

For starting it for development, the options are below.
```shell
start.sh front-dev
```
This will start the nginx server, run the frontend in dev mode with yarn dev, and run the backend server as well.
This has Hot Module Replacement (HMR) enabled, which means that if you change any of the frontend code, the yarn server will detect and rebuild that part of the front end, so you can rapidly see the results of the change. 
You will see a message like this when its done building.
```shell
chunk (runtime: runtime) vendor.js (vendor) (id hint: commonVendor) 1.65 MiB [initial] split chunk (cache group: commonVendor) (name: vendor)
webpack compiled successfully (e76cbaa5240e788b)
```
You will also have to initially wait when starting the server because it has to build it the first time.
If you see red errors, like ERR port in use, this is likely because parts of the website were already running, and the port is taken.
You can run:
```shell
start.sh stop
```
To kill any process using those ports. Front-dev runs this automatically anyways, but if errors come up try using the stop route. 
```shell
start.sh back-dev
```
This is similar to front-dev, except it doesn't initially run kill, and it doesn't start the backend server.
The intended use of this is to start all the other servers except the backend, like nginx, and the frontend HMR server, so you can then use VS Code to start the backend server with the python debugger. 
Once you run start.sh back-dev, navigate to the label_studio.py file, and run it using the launch config .vscode/launch.json. 

### Rebuilding the front end
When you are done making changes to label studio, run:
```shell
./start.sh build
```
This will compile label studio (it may take around 10 minutes) and store it in `label_studio/core/static_build`.
Then just run `./start.sh` without any arguments, and it will start label studio and host the static files.

### The DZI Pipeline (convert_to_dzi.py)

Deep Zoom Images (DZI) are a tiled image format that allows OpenSeadragon to efficiently render huge images by only loading the tiles needed for the current zoom level and viewport.

To convert images, run:
```shell
./start.sh convert
```
This runs `convert_to_dzi.py`, which grabs images from the `hugeimages/` folder and converts them into DZI format, placing the output into the `dzi/` folder. NGINX then serves these directly (see the `/dzi/` location block in the nginx config above).

The script will skip images that have already been converted, so re-running it is safe and fast. There are two additional flags:
```shell
./start.sh convert --force
```
Reconverts all images even if a DZI already exists.
```shell
./start.sh convert --clear
```
Deletes all existing DZIs without converting anything. Useful for cleaning up if you need to remove old images.

`start.sh` passes any additional arguments directly to `convert_to_dzi.py`, so if you need to look at the full set of options or run the script directly, you can check that file.

### Setting Up a HugeImage Project

1. Download the images onto the server (likely from OneDrive) and place them into the `hugeimages/` folder.

2. Run the conversion:
```shell
./start.sh convert
```

3. In Label Studio, create a new project and select the **HugeImage** template.

4. This should redirect you to the config page. Switch from **View** to **Code** mode to directly edit the configuration XML. Here you can modify properties like labels, colors, default annotation size, etc.

5. You can create the project now and import data later, or go to **Import Data** and import your files before creating the project.

6. When importing, Label Studio just needs a file with the same name as the image — it could technically be any file. However, **importing the original image is strongly recommended** for two reasons:
   - It avoids potential naming or lookup issues
   - If an ML backend is connected and asked for predictions, it gets sent whatever file was imported — so using the original image ensures the ML backend receives the correct data

## Code Specific Information

### Modifying HugeImageModel or HugeImageView
When using the hugeimage project type, its using HugeImageModel and HugeImageView
which can be found here:
```
web/libs/editor/src/tags/object/HugeImage/HugeImageView.jsx
web/libs/editor/src/tags/object/HugeImage/HugeImageModel.jsx
```

HugeImageModel is inheriting from the regular image project type, 
which can be mostly found here: `web/libs/editor/src/tags/object/Image/Image.js`
It was likely a mistake to make this inherit from image, and override anything that required it.
Instead it should have been made from scratch, and instead use the same mixins that Image.js used. Mixins are JavaScript's way of doing multi-inheritance or interfaces.

### Openseadragon and click+drag functionality 
The OpenSeadragon renderer is capturing all mouse events, except mouse move.
So if you try to click on the stage, it goes to OpenSeadragon (and not the stage).
If you click on an object with click and drag functionality, it goes to OpenSeadragon (and not global).
So one of the things we had to do was essentially resend these events directly when OpenSeadragon captures them.
If you are trying to modify HugeImageView, and are struggling with events, particularly
the click and drag or selection, its likely OSD capturing the global events.

### Current Bugs
- The preview image cant have annotations drawn on it, because the source its getting it from probably has the wrong size.
- COCO importing doesnt work, the data is bad somehow. Exporting something as label-studio-common-format that was imported as COCO wont fix it. Its possible the label studio SDK conversion could.
- Sometimes when you delete all the tasks on a project, it causes a crash, though other than the red screen showing the crash, it doesnt do anything else. We can look at the trace when using a breakpoint on caught exceptions, and it seems like its setting actions to do, like delete tasks, delete annotations, then delete projects, and one of these is causing an issue. This might only happen if COCO files are imported, which means it may be the annotation information on those that is broken.
- Two point click to draw an annotation is disabled, but also a useful feature. It was disabled in `web/libs/editor/src/mixins/DrawingTool.js` by making one of the functions on click for two point just return immediately. It causes a crash — it may be trying to render an in-progress annotation in the wrong parent. The exact cause was not determined.

### Modifying the Columns

One of the features that was requested was a column for how many regions there were in the task.
The terms label studio actually uses are "regions" for the boxes, and "annotations"
as sort of an annotators opinion of the regions of the image, so there can be multiple per image.
So instead we calculate the average regions per annotation.
Adding a new column has a few steps, one of which is creating a queryset in the database language to actually fill the column with, and adding the column itself.