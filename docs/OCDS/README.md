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
To stop them all you can do 
You can run
```shell
start.sh stop
```

If you just want to start the server for production, just run
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
If you see red errors, like ERR port in use
This is likely because parts of the website were already running, and the port is taken.
You can run
```shell
start.sh stop
```
To kill any process using those ports. Front-dev runs this automatically anyways, but if errors come up try using the stop route. 
```shell
start.sh back-dev
```
This is similar to front-dev, except it doesn't initially run kill, and it doesn't start the backend server.
The intended use of this is to start all the other servers except the backend, like nginx, and the frontend HMR server, so you can then use vs code to start the backend server with the python debugger. 
Once you run start.sh back-dev, navigate to the label_studio.py file, and run it using the launch config .vscode/launch.json. 



### Structure of the software

