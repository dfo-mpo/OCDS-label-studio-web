
import ObjectTag from "../../../components/Tags/Object";
import Tree from "../../../core/Tree";
import styles from "../../../components/ImageView/Image.scss";
import { errorBuilder } from "../../../core/DataValidator/ConfigValidator";
import { chunks } from "../../../utils/utilities";
import { LoadingOutlined, TranslationOutlined } from "@ant-design/icons";
import { Toolbar } from "../../../components/Toolbar/Toolbar";
import { ImageViewProvider } from "../../../components/ImageView/ImageViewContext";
import ResizeObserver from "../../../utils/resize-observer";
import { debounce } from "../../../utils/debounce";
import Constants from "../../../core/Constants";
import { Component, createRef, forwardRef, Fragment, memo, useEffect, useRef, useState, useCallback } from "react";import { observer, useObserver } from "mobx-react";
import { getEnv, getRoot, isAlive } from "mobx-state-tree";
import { reaction, observable, autorun } from "mobx";
import OpenSeadragon from "openseadragon";
import { Group, Layer, Line, Rect, Stage } from "react-konva";
import ImageGrid from "../../../components/ImageGrid/ImageGrid";
import ImageTransformer from "../../../components/ImageTransformer/ImageTransformer.jsx";
//web/libs/editor/src/components/ImageTransformer/ImageTransformer.jsx

import {
  FF_DEV_1442,
  FF_DEV_3077,
  FF_DEV_3793,
  FF_LSDV_4583_6,
  FF_LSDV_4711,
  FF_LSDV_4930,
  FF_ZOOM_OPTIM,
  isFF,
} from "../../../utils/feature-flags";
import { clamp } from "lodash";

const splitRegions = (regions) => {
  const brushRegions = [];
  const shapeRegions = [];
  const l = regions.length;
  let i = 0;

  for (i; i < l; i++) {
    const region = regions[i];

    if (region.type === "brushregion") {
      brushRegions.push(region);
    } else {
      shapeRegions.push(region);
    }
  }

  return {
    brushRegions,
    shapeRegions,
  };
};

const Region = memo(({ region, showSelected = false }) => {
  return useObserver(() => Tree.renderItem(region, region.annotation, true));
});

const RegionsLayer = memo(({ regions, name, useLayers, showSelected = false }) => {
  const content = regions.map((el) => <Region key={`region-${el.id}`} region={el} showSelected={showSelected} />);

  return useLayers === false ? content : <Layer name={name}>{content}</Layer>;
});

const Regions = memo(({ regions, useLayers = true, chunkSize = 15, suggestion = false, showSelected = false }) => {
  return (
    <ImageViewProvider value={{ suggestion }}>
      {(chunkSize ? chunks(regions, chunkSize) : regions).map((chunk, i) => (
        <RegionsLayer
          key={`chunk-${i}`}
          name={`chunk-${i}`}
          regions={chunk}
          useLayers={useLayers}
          showSelected={showSelected}
        />
      ))}
    </ImageViewProvider>
  );
});

const DrawingRegion = observer(({ item }) => {
  const { drawingRegion } = item;

  if (!drawingRegion) return null;
  if (item.multiImage && item.currentImage !== drawingRegion.item_index) return null;

  const Wrapper = drawingRegion && drawingRegion.type === "brushregion" ? Fragment : Layer;

  return <Wrapper>{drawingRegion ? <Region key={"drawing"} region={drawingRegion} /> : drawingRegion}</Wrapper>;
});

const SELECTION_COLOR = "#40A9FF";
const SELECTION_SECOND_COLOR = "white";
const SELECTION_DASH = [3, 3];

/**
 * Selection area during selection — dashed rect
 */
const SelectionRect = observer(({ item }) => {
  if(!item.onCanvasRect){
    console.log("Selection rect: no canvas rect?")
  }
  const { x, y, width, height } = item.onCanvasRect;

  const positionProps = {
    x,
    y,
    width,
    height,
    listening: false,
    strokeWidth: 1,
  };

  return (
    <Layer>
      <Rect {...positionProps} stroke={SELECTION_COLOR} dash={SELECTION_DASH} strokeScaleEnabled={false} />
      <Rect
        {...positionProps}
        stroke={SELECTION_SECOND_COLOR}
        dash={SELECTION_DASH}
        dashOffset={SELECTION_DASH[0]}
        strokeScaleEnabled={false}
      />
    </Layer>
  );
});

/**
 * Multiple selected regions when transform is unavailable — just a box with anchors
 */
const SelectionBorders = observer(({ item, selectionArea }) => {
  const { selectionBorders: bbox } = selectionArea;

  if (!isFF(FF_DEV_3793)) {
    bbox.left = bbox.left * item.stageScale;
    bbox.right = bbox.right * item.stageScale;
    bbox.top = bbox.top * item.stageScale;
    bbox.bottom = bbox.bottom * item.stageScale;
  }

  const points = bbox
    ? [
        { x: bbox.left, y: bbox.top },
        { x: bbox.right, y: bbox.top },
        { x: bbox.left, y: bbox.bottom },
        { x: bbox.right, y: bbox.bottom },
      ]
    : [];
  const ANCHOR_SIZE = isFF(FF_DEV_3793) ? 6 / item.stageScale : 6;

  return (
    <>
      {bbox && (
        <Rect
          name="regions_selection"
          x={bbox.left}
          y={bbox.top}
          width={bbox.right - bbox.left}
          height={bbox.bottom - bbox.top}
          stroke={SELECTION_COLOR}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {points.map((point, idx) => {
        return (
          <Rect
            key={idx}
            x={point.x - ANCHOR_SIZE / 2}
            y={point.y - ANCHOR_SIZE / 2}
            width={ANCHOR_SIZE}
            height={ANCHOR_SIZE}
            fill={SELECTION_COLOR}
            stroke={SELECTION_SECOND_COLOR}
            strokeWidth={2}
            strokeScaleEnabled={false}
            listening={false}
          />
        );
      })}
    </>
  );
});

const SelectionLayer = observer(({ item, selectionArea }) => {
  const scale = isFF(FF_DEV_3793) ? 1 : 1 / (item.zoomScale || 1);
  const [isMouseWheelClick, setIsMouseWheelClick] = useState(false);
  const [shift, setShift] = useState(false);
  const isPanTool = item.getToolsManager().findSelectedTool()?.fullName === "ZoomPanTool";

  const dragHandler = (e) => setIsMouseWheelClick(e.buttons === 4);
  const handleKey = (e) => setShift(e.shiftKey);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    window.addEventListener("mousedown", dragHandler);
    window.addEventListener("mouseup", dragHandler);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      window.removeEventListener("mousedown", dragHandler);
      window.removeEventListener("mouseup", dragHandler);
    };
  }, []);

  const disableTransform = item.zoomScale > 1 && (shift || isPanTool || isMouseWheelClick);

  let supportsTransform = true;
  let supportsRotate = true;
  let supportsScale = true;

  item.selectedRegions?.forEach((shape) => {
    supportsTransform = supportsTransform && shape.supportsTransform === true;
    supportsRotate = supportsRotate && shape.canRotate === true;
    supportsScale = supportsScale && true;
  });

  supportsTransform =
    supportsTransform &&
    (item.selectedRegions.length > 1 ||
      ((item.useTransformer || item.selectedShape?.preferTransformer) && item.selectedShape?.useTransformer));

  return (
    <Layer scaleX={scale} scaleY={scale} >
      {selectionArea.isActive ? (
        <SelectionRect item={selectionArea} />
      ) : !supportsTransform && item.selectedRegions.length > 1 ? (
        <SelectionBorders item={item} selectionArea={selectionArea} />
      ) : null}
      <ImageTransformer
        item={item}
        rotateEnabled={supportsRotate}
        supportsTransform={!disableTransform && supportsTransform}
        supportsScale={supportsScale}
        selectedShapes={item.selectedRegions}
        singleNodeMode={item.selectedRegions.length === 1}
        useSingleNodeRotation={item.selectedRegions.length === 1 && supportsRotate}
        draggableBackgroundSelector={`#${TRANSFORMER_BACK_ID}`}
      />
      </Layer>
  );
});

const Selection = observer(({ item }) => {
  const { selectionArea } = item;

  return (
    <>
      <Layer name="selection-regions-layer" />
      {/*
        <SelectionLayer item={item} selectionArea={selectionArea} />
        */}
    </>
  );
});

/*
 * Component that creates an overlay on top
 * of the image to support Magic Wand tool
 */
const CanvasOverlay = observer(({ item }) => {
  return (
    <canvas
      ref={(ref) => item.setOverlayRef(ref)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1002,
        ...item.imageTransform,
      }}
    />
  );
});

export default observer(
  class SeadragonView extends Component {
    viewerRef = createRef();
    crosshairRef = createRef();
    lastOffsetWidth = -1;
    lastOffsetHeight = -1;

    state = {
      imgStyle: {},
      pointer: [0, 0],
    };


    initializeOpenSeadragon = () => {
      const { item } = this.props;
      const containerId = `openseadragon-${item.name}`;

      // if (this.viewerRef.current) {
      //   this.viewerRef.current.destroy();
      // }
      
      const viewer = OpenSeadragon({
        id: containerId,
        prefixUrl: "https://openseadragon.github.io/openseadragon/images/",//icons i think
        tileSources: "http://20.220.26.156:8080/dzi/3/SABLE_ISLAND.dzi",//item.currentSrc?
        showNavigator: true,//TODO: add this to config
        showZoomControl: true,
        showHomeControl: false,
        showFullPageControl: false,
        showRotationControl: item.rotatecontrol,
        maxZoomPixelRatio: 5,
        minZoomLevel: 0.0,//item.negativezoom ? 0.1 : 1,
        zoomPerClick: 1.5,
        zoomPerScroll: 1.5,
        crossOriginPolicy: item.imageCrossOrigin,
        animationTime: 0.5,
        blendTime: 0.1,
        constrainDuringPan: false,
        wrapHorizontal: false,
        wrapVertical: false,
        visibilityRatio: 0.5,
        gestureSettingsMouse: {//disable built-in mouse controls
          clickToZoom: false,
          dblClickToZoom: false,
          flickEnabled: false,
          dragToPan: true,   
          scrollToZoom: true,
        },
      });

      //seadragon tools now work over the stage! :D

      if (viewer.controls) {
        for (let i = 0; i < viewer.controls.length; i++) {
          viewer.controls[i].element.style.zIndex = '1016';
          viewer.controls[i].container.style.zIndex = '1016';
          viewer.controls[i].wrapper.style.zIndex = '1016';
        }
      }

      // if(viewer.canvas){
      //   viewer.canvas.style.zIndex='1001';
      // }
      
      // // ---- Shim Konva-like API ----
      // viewer.getAbsoluteTransform = function () {
      //   return {
      //     copy() { return this; },
      //     invert() { return this; },
      //     point({ x, y }) {
      //       const p = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y));
      //       return { x: p.x, y: p.y };
      //     }
      //   };
      // };

      this.viewerRef.current = viewer;

      item.setViewer(this.viewerRef.current);

      this.setupEventHandlers();
    };

    setupEventHandlers = () => {
      const viewer = this.viewerRef.current;
      const { item } = this.props;

      viewer.addHandler("open", () => {
        const image = viewer.world.getItemAt(0);
        const contentSize = image.getContentSize();

        const mockEvent = {
          target: {
            naturalWidth: contentSize.x,
            naturalHeight: contentSize.y,
          },
        };
        item.updateImageSize(mockEvent);
        item.currentImageEntity?.setImageLoaded(true);
      });

      viewer.addHandler("zoom", (event) => {
        if (item.setZoom) {
          item.setZoom(event.zoom);
        }
      });

      viewer.addHandler("pan", (event) => {
        if (item.setZoomPosition) {
          const center = event.center;
          const viewport = viewer.viewport;
          const containerSize = viewport.getContainerSize();
          const viewportPoint = viewport.viewportToViewerElementCoordinates(center);

          item.setZoomPosition(-viewportPoint.x + containerSize.x / 2, -viewportPoint.y + containerSize.y / 2);
        }
      });
    };

    onResize = debounce(() => {
      requestAnimationFrame(() => {
        if (!this?.props?.item?.containerRef) return;
        const { offsetWidth, offsetHeight } = this.props.item.containerRef;

        if (this.props.item.naturalWidth <= 1) return;
        if (this.lastOffsetWidth === offsetWidth && this.lastOffsetHeight === offsetHeight) return;

        this.props.item.onResize(offsetWidth, offsetHeight, true);
        this.lastOffsetWidth = offsetWidth;
        this.lastOffsetHeight = offsetHeight;
      });
    }, 16);

    attachObserver = (node) => {
      if (this.resizeObserver) this.detachObserver();

      if (node) {
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(node);
      }
    };

    detachObserver = () => {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    };

    componentDidMount() {
      const { item } = this.props;

      window.addEventListener("resize", this.onResize);
      this.attachObserver(item.containerRef);

      if (item.currentSrc || item.parsedValue) {
        this.initializeOpenSeadragon();
      }
    }//end did mount

    componentWillUnmount() {
      this.detachObserver();
      window.removeEventListener("resize", this.onResize);

      if (this.viewerRef.current) {
        this.viewerRef.current.destroy();
        this.viewerRef.current = null;
      }

      if (this.disposeReaction) {
        this.disposeReaction();
      }
    }

    componentDidUpdate(prevProps) {
      this.onResize();

      if (prevProps.item.currentSrc !== this.props.item.currentSrc) {
        if (this.viewerRef.current && this.props.item.currentSrc) {
          this.viewerRef.current.open(this.props.item.currentSrc);
        } else if (this.props.item.currentSrc) {
          this.initializeOpenSeadragon();
        }
      }
    }

    renderTools() {
      const { item, store } = this.props;
      if (store.annotationStore.viewingAll) return null;
      const tools = item.getToolsManager().allTools();
      //console.log("Adding tools: ", tools);
      return <Toolbar tools={tools} />;
    }

    render() {
      const { item, store } = this.props;
      if (!isAlive(item)) return null;
      if (!store.task || !item.currentSrc) return null;

      const wrapperClasses = [
        styles.wrapperComponent,
        item.images.length > 1 ? styles.withGallery : styles.wrapper,
      ];

      const imagePositionClassnames = [
        styles.image_position,
        styles[`image_position__${item.verticalalignment === "center" ? "middle" : item.verticalalignment}`],
        styles[`image_position__${item.horizontalalignment}`],
      ];

      const containerStyle = {
        position: "relative",
        width: "100%",
        height: "400px",
        background: "#000",
        overflow: "hidden",
      };

      const seadragonId = `openseadragon-${item.name}`;

      const entity = item.currentImageEntity;
      const filters = `saturate(${entity.saturationGrade}%) brightness(${entity.brightnessGrade}%) contrast(${entity.contrastGrade}%)  invert(${entity.invertGrade}%)`

      return (
        <ObjectTag item={item} className={wrapperClasses.join(" ")}>
          <div
            ref={(node) => {
              item.setContainerRef(node);
              this.attachObserver(node);
            }}
            style={containerStyle}
          >
            {/* OpenSeadragon Viewer */}
            <div
              id={seadragonId}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                filter: filters,
                zIndex:900
              }}
              >
                {/*add code for if not loaded show loading thing instead*/}
              {<EntireStage
                item={item}
                viewerRef={this.viewerRef}
                crosshairRef={this.crosshairRef}
                onClick={this.handleOnClick}
                imagePositionClassnames={imagePositionClassnames}
                state={this.state}
              />}

              <Selection item={item} />
              <DrawingRegion item={item} />

              {item.crosshair && (
                <Crosshair
                  ref={this.crosshairRef}
                  width={item.containerWidth || item.stageWidth}
                  height={item.containerHeight || item.stageHeight}
                />
                )}
            </div>

            {/* Toolbar pinned to top-right */}
            {item.hasTools && (
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  zIndex: 1100,
                }}
              >
                {this.renderTools()}
              </div>
            )}

            {/* Loading indicator */}
            {(this.props.item.stageWidth <= 1 || !item.hasTools) && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  color: "#fff",
                }}
              >
                <LoadingOutlined />
              </div>
            )}
          </div>
        </ObjectTag>
      )
    }
  }
);

export const EntireStage = observer(({ item, viewerRef, imagePositionClassnames, state, crosshairRef }) => {
  const { store } = item;
  
  let size, position;
  if (item.isFF && item.isFF('FF_ZOOM_OPTIM')) {
    size = { width: item.containerWidth, height: item.containerHeight };
    position = { x: item.zoomingPositionX + item.alignmentOffset.x, y: item.zoomingPositionY + item.alignmentOffset.y };
  } else {
    size = { ...item.canvasSize };
    position = { x: item.zoomingPositionX, y: item.zoomingPositionY };
  }
  
  let dragonDefined = (viewerRef != null && viewerRef.current != null)
  let listenerAdded = useRef(false)
  let originOffsetRef = useRef(null)
  let overlayAddedRef = useRef(false)
  let overlayRef = useRef(null)
  let visibleOffsetRef = useRef(null)
  
  let viewport_width = useRef(0.0)
  let viewport_height = useRef(0.0)

  let canvas_width = useRef(0.0)
  let canvas_height = useRef(0.0)

  let tlBound = useRef(null)
  let brBound = useRef(null)

  //indicator to see if the event position matches viewport coordinates, it does
  // let indicatorRef = useRef(null)

  useEffect(() => {
    if(viewerRef.current && originOffsetRef.current){
      if(!overlayRef.current){
    
        overlayRef.current = document.createElement('div');
      let testOverlay = overlayRef.current
      testOverlay.id = 'overlay-container';
      //testOverlay.style.background = 'red';
      //testOverlay.style.opacity = '0.5';
      
      // Move origin-offset content into overlay
      //originOffsetRef.current.parentNode.replaceChild(testOverlay, originOffsetRef.current);
      testOverlay.appendChild(originOffsetRef.current);
      
      viewerRef.current.addOverlay({
        element: testOverlay,
        location: new OpenSeadragon.Rect(0, 0, 1, 1),
      });
      
      // console.log("Added Overlay")
        }
      }
  },[viewerRef.current, originOffsetRef.current])
  
  //disable panning when trying to draw an annotation
  useEffect(() => {
      if (!viewerRef.current) return;

      // MobX autorun will react to any observable used inside
      const disposer = autorun(() => {
        const hasActiveStates = item.activeStates().length > 0;
        viewerRef.current.gestureSettingsMouse.dragToPan = !hasActiveStates;
      });

      // cleanup when component unmounts
      return () => disposer();
  }, [item, viewerRef]);

  // if (dragonDefined) {
  //   const viewport = viewerRef.current.viewport;
  //   const topLeft = viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0));
  //   const bottomRight = viewport.pixelFromPoint(new OpenSeadragon.Point(1, 1));
  //   stage_width = bottomRight.x - topLeft.x;
  //   stage_height = bottomRight.y - topLeft.y;

  // }

  // console.log("Entire Stage, dragonDefined: ",dragonDefined)


  function canvasToInternal(canvasX, canvasY){
    //Normalize mouse position to [0, 1] in stage space
    // const nx = e.evt.offsetX / canvas_width.current;
    // const ny = e.evt.offsetY / canvas_height.current;

    if (!canvas_width.current || !canvas_height.current || !brBound.current || !tlBound.current) {
      updateStageSize()
      //throw new Error("updateStageSize has not been called yet, references are null");
    }

    const nx = canvasX / canvas_width.current;
    const ny = canvasY / canvas_height.current;
    
    //Compute visible viewport span
    const spanX = brBound.current.x - tlBound.current.x;
    const spanY = brBound.current.y - tlBound.current.y;

    //Map into viewport coordinates
    const ix = tlBound.current.x + nx * spanX
    const iy = tlBound.current.y + ny * spanY

    return {x: ix,y: iy}
  }


  // const handleEvent = (type) => (e) => {
  //   //console.log("Regular event: ",e)
  //   const viewport = viewerRef.current.viewport;
  //   //const viewportPos = viewport.windowToViewportCoordinates(new OpenSeadragon.Point(e.offsetX, e.offsetY))
  //   const g = {x: e.offsetX/e.target.offsetWidth, y: e.offsetY/e.target.offsetHeight}
  //   //console.log("Viewport pos: ",viewportPos)
  //   console.log("g pos: ",g, e.target)
    
  //   item.event(type, e, g.x, g.y);//this goes to image.js 
  // }

  const handleStageEvent = (type) => (e) => {

    const isStage = e.target?.constructor.name === "Stage" 
    const isRect = e.target?.constructor.name === "Stage" 
    
    if(isRect){
      if(type=="click"){
          console.log("Clicked on rect: ",e.target)
      }
      console.log("Rect event: ",type)
    }

    //so if we add pointer-events: auto to the kanvas we do get mouse moves on rect
    //its likely that the region error is just an event listener problem
    //check the target of the handleOSDevent, its possible its a diffent object?
    //like the origianl event?
    //canvas could also work

    if(isStage){

      if(type=="mousemove"){

        const viewportPos = canvasToInternal(e.evt.offsetX, e.evt.offsetY)
        // console.log("viewportPos: ",viewportPos)
        item.updateCanvasSize(viewerRef.current.canvas.offsetWidth,viewerRef.current.canvas.offsetHeight) 
        item.event(type, e, viewportPos.x, viewportPos.y);//this goes to image.js 
      }
    }
  }
    
    const handleOSDEvent = (type) => (e) => {
      const viewport = viewerRef.current.viewport;
      const viewportPos = viewport.pointFromPixel(e.position)
      //outside of image
      if(viewportPos.x < 0 || viewportPos.y < 0 || viewportPos.x > 1 || viewportPos.y > 1){
        return
      }
      // updateStageSize()
      //console.log("Viewport pos: ",viewportPos, " Event: ",e)
      item.updateCanvasSize(viewerRef.current.canvas.offsetWidth,viewerRef.current.canvas.offsetHeight) 
      if(type !== "mousemove"){
        console.log("Non mouse move: ", type)
      }
      item.event(type, e.originalEvent, viewportPos.x, viewportPos.y);//this goes to image.js 
      
    //if(e.originalEvent.shiftKey){

  };

  /*
  Input is broken
  Regions dont know how zoomed in we are / what we are looking at, either tell them where we are zoomed in
  or just force it to always be zoomed out

  to fix:
  Adding regions, drawing selection box, verify drawing regions in right spot

  todo:
  auto conversion of images to dzi, and convert urls to find the dzis
  so that the preview still renders the image regularly 

  */


      function updateStageSize() {
        if ((!item.stageRef || !originOffsetRef.current || !viewerRef.current || !visibleOffsetRef.current)) return


        // const rect = viewerRef.current.container.getBoundingClientRect()
        // const element_width = rect.width
        // const element_height = rect.height

        const viewport_end = viewerRef.current.viewport.viewportToWindowCoordinates(new OpenSeadragon.Point(1.0,1.0))
        const viewport_start = viewerRef.current.viewport.viewportToWindowCoordinates(new OpenSeadragon.Point(0.0,0.0))

        viewport_width.current = viewport_end.x-viewport_start.x
        viewport_height.current = viewport_end.y-viewport_start.y

        const visible_bounds = viewerRef.current.viewport.getBounds(true)//(viewport reference frame)

        const offset_rect = originOffsetRef.current.getBoundingClientRect()
        const offset_pos = { x: offset_rect.left, y: offset_rect.top };

        tlBound.current = visible_bounds.getTopLeft()
        brBound.current = visible_bounds.getBottomRight()

        brBound.current.x = _.clamp(brBound.current.x,0.0,1.0)
        brBound.current.y = _.clamp(brBound.current.y,0.0,1.0)
        tlBound.current.x = _.clamp(tlBound.current.x,0.0,1.0)
        tlBound.current.y = _.clamp(tlBound.current.y,0.0,1.0)

        const tlWindow = viewerRef.current.viewport.viewportToWindowCoordinates(tlBound.current)
        const brWindow = viewerRef.current.viewport.viewportToWindowCoordinates(brBound.current)

        const bound_width_window = brWindow.x-tlWindow.x
        const bound_height_window = brWindow.y-tlWindow.y

        canvas_height.current = bound_height_window
        canvas_width.current = bound_width_window

        item.stageRef.width(bound_width_window);
        item.stageRef.height(bound_height_window);
        const stage_content_internal_resolution = { x: 100, y: 100 }; // Stage point we want to reach bottom-right

        //this is normally STAGE_RELATIVE_HEIGHT in imageview/image.js
        //which is a hardcoded constant = 100
        
        const scaleX = viewport_width.current  / stage_content_internal_resolution.x;
        const scaleY = viewport_height.current / stage_content_internal_resolution.y; 
        
        //so the visibleOffset div is a child of the originOffset div
        //so when we want to offset this container to be at a position on the screen
        //aka tlWindow, this position has already been offset by the translation applied to originoffsetdiv
        //if we just used it as is, we would be translating by that twice
        //so we subtract the origin of the offset div, so we only do it once

        //you can also think of this as computing the vector from the offset origin to the position on the screen
        //and then applying that as our translation, in offset origin space

        const container = visibleOffsetRef.current
        container.style.position = 'absolute'; 
        container.style.left = `${tlWindow.x-offset_pos.x}px`;
        container.style.top  = `${tlWindow.y-offset_pos.y}px`;

        item.stageRef.scale({ x: scaleX, y: scaleY });
        item.stageRef.position({ x: -scaleX* stage_content_internal_resolution.x*tlBound.current.x, y: -scaleY*stage_content_internal_resolution.y*tlBound.current.y }); // top-left corner as origin
        // item.stageRef.batchDraw();
      }

    // initial size
    updateStageSize();

  useEffect(() => {
    // resize listener
    if(!listenerAdded.current && viewerRef.current){
      viewerRef.current.addHandler("animation", updateStageSize);
      viewerRef.current.addHandler("animation-finish", updateStageSize);

      listenerAdded.current = true
      //window.addEventListener("resize", updateStageSize);
      console.log("Succesfully added event listener for resizing")

      console.log("Now adding event listeners for tools")

      // viewerRef.current.addHandler("canvas-click", handleOSDEvent('click'));
      // viewerRef.current.addHandler("canvas-drag", handleOSDEvent('drag'));
      // viewerRef.current.addHandler("canvas-double-click", handleOSDEvent('double-click'));
      // viewerRef.current.addHandler("canvas-drag-end", handleOSDEvent('drag-end'));

      // viewerRef.current.canvas.addEventListener("click", handleEvent("click"))
      // viewerRef.current.canvas.addEventListener("mousemove", handleEvent("mousemove"))
      // viewerRef.current.canvas.addEventListener("mousedown", handleEvent("mousedown"))
      // viewerRef.current.canvas.addEventListener("mouseup", handleEvent("mouseup"))
      // viewerRef.current.canvas.addEventListener("dblclick", handleEvent("dblclick"))
      
      viewerRef.current.addHandler("canvas-move", handleOSDEvent('mousemove'));//move without mouse down
      viewerRef.current.addHandler("canvas-drag", handleOSDEvent('mousemove'));//move while mouse down
      viewerRef.current.addHandler("canvas-press", handleOSDEvent('mousedown'));
      viewerRef.current.addHandler("canvas-release", handleOSDEvent('mouseup'));
      viewerRef.current.addHandler("canvas-click", handleOSDEvent("click"));

      //we can get modifier already, but i guess if we wanted a hotkey
      //viewerRef.current.addHandler("canvas-key", handleOSDkeyEvent('canvas-key'));

    }
    return () => {
    }
  }, [viewerRef.current]);

  // const stageRefCallback = useCallback((ref) => {
  //   if(ref == null){
  //     console.log("What the heck")
  //     item.setStageRef(item.stageRef);
  //   }
  //   else{
  //     item.stageRef = ref;
  //   }
  // }, [item]);

  return (
    <div id="EntireStage">
      
      <div id="origin-offset" ref={originOffsetRef} style={{
      }}>

      <div id="visible-offset" ref={visibleOffsetRef}
        style={{
        zIndex: 1015,
        pointerEvents: 'none',
      }}>

      <Stage
        ref={(ref) => {
          item.setStageRef(ref);
        }}
        className={[item.styles?.['image-element'], ...imagePositionClassnames].join(' ')}
        width={100}
        height={100}
        style={{
          zIndex:2000,
          pointerEvents:"auto",
        }}
        onMouseMove={handleStageEvent('mousemove')}
        onClick={handleStageEvent('click')}
        >

        <StageContent item={item} store={store} state={state} crosshairRef={crosshairRef} />
      </Stage>

        {/*
      */}
    </div>{/*visible div*/}
  </div>{/*offset div*/}
    </div>//entire stage
  );
});

// import { observer } from "mobx-react";
// import { Layer, Rect } from "react-konva";

/**
 * Create a cached 1-cell grid pattern for Konva.
 * This is recreated only when gridsize or color changes.
 */
const makeGridPattern = (gridSize, color) => {
  const canvas = document.createElement("canvas");
  canvas.width = gridSize;
  canvas.height = gridSize;

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;

  ctx.beginPath();
  ctx.rect(0, 0, gridSize, gridSize);
  ctx.stroke();

  return canvas;
};

export const GridOverlay = observer(({ item }) => {
  // Guard — same semantics as the original ImageGrid
  if (!item.stageWidth || !item.stageHeight || !item.gridsize) return null;

  const patternImage = makeGridPattern(item.gridsize, item.gridcolor);

  const upscale_factor = 30

  return (
    <Layer
      name="ruler"
      opacity={0.5}
      listening={false}
      perfectDrawEnabled={false}
    >
      <Rect
        x={0}
        y={0}
        width={item.stageWidth*upscale_factor}
        height={item.stageHeight*upscale_factor}
        fillPatternImage={patternImage}
        fillPatternScale={{ x: 1/upscale_factor, y: 1/upscale_factor }}
        shadowForStrokeEnabled={false}
      />
    </Layer>
  );
});


const StageContent = observer(({ item, store, state, crosshairRef }) => {
  if (!isAlive(item)) return null;
  if (!store.task || !item.currentSrc) return null;

  const regions = item.regs;
  const paginationEnabled = !!item.isMultiItem;
  const wrapperClasses = [styles.wrapperComponent, item.images.length > 1 ? styles.withGallery : styles.wrapper];

  if (paginationEnabled) wrapperClasses.push(styles.withPagination);

  const { brushRegions, shapeRegions } = splitRegions(regions);

  const { brushRegions: suggestedBrushRegions, shapeRegions: suggestedShapeRegions } = splitRegions(item.suggestions);

  const renderableRegions = Object.entries({
    brush: brushRegions,
    shape: shapeRegions,
    suggestedBrush: suggestedBrushRegions,
    suggestedShape: suggestedShapeRegions,
  });

  return (
    <>
      {/* Hack to keep stage in place when there's no regions */}
      {regions.length === 0 && (
        <Layer>
          <Line points={[0, 0, 0, 1]} stroke="rgba(0,0,0,0)" />
        </Layer>
      )}
        {/*       
      {item.grid && item.sizeUpdated && <ImageGrid item={item} />} 
      */}

      {/* A more efficient grid overlay so it can handle 40k by 40k images  */}
      {item.grid && item.sizeUpdated && <GridOverlay item={item} />}

      {false ? <TransformerBack item={item} /> : null}

      {renderableRegions.map(([groupName, list]) => {
        const isBrush = groupName.match(/brush/i) !== null;
        const isSuggestion = groupName.match("suggested") !== null;

        return list.length > 0 ? (
          <Regions
            key={groupName}
            name={groupName}
            regions={list}
            useLayers={isBrush === false}
            suggestion={isSuggestion}
          />
        ) : (
          <Fragment key={groupName} />
        );
      })}
      <Selection item={item} isPanning={state.isPanning} />
      <DrawingRegion item={item} />

      {item.crosshair && (
        <Crosshair
          ref={crosshairRef}
          width={isFF(FF_ZOOM_OPTIM) ? item.containerWidth : item.stageWidth}
          height={isFF(FF_ZOOM_OPTIM) ? item.containerHeight : item.stageHeight}
        />
      )}
    </>
  );
});
