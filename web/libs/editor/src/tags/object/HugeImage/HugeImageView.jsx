
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
import { Component, createRef, forwardRef, Fragment, memo, useEffect, useRef, useState } from "react";
import { observer, useObserver } from "mobx-react";
import { getEnv, getRoot, isAlive } from "mobx-state-tree";
import { reaction } from "mobx";
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
  for (const region of regions) {
    if (region.type === "brushregion") brushRegions.push(region);
    else shapeRegions.push(region);
  }
  return { brushRegions, shapeRegions };
};

const Region = memo(({ region, showSelected = false }) => {
  return useObserver(() => Tree.renderItem(region, region.annotation, true));
});

const RegionsLayer = memo(({ regions, name, useLayers, showSelected = false }) => {
  const content = regions.map((el) => <Region key={`region-${el.id}`} region={el} showSelected={showSelected} />);

  return useLayers === false ? content : <Layer name={name}>{content}</Layer>;
});

const Regions = memo(({ regions, useLayers = true, chunkSize = 50000, suggestion = false, showSelected = false }) => {
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

  return (
    <div
      // Inline fallback for styles.drawingRegion
      style={{
        position: "absolute",
        pointerEvents: "none",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 1005,
      }}
    >
      {drawingRegion ? <Region key={"drawing"} region={drawingRegion} /> : null}
    </div>
  );
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
    <>
      <Rect {...positionProps} stroke={SELECTION_COLOR} dash={SELECTION_DASH} strokeScaleEnabled={false} />
      <Rect
        {...positionProps}
        stroke={SELECTION_SECOND_COLOR}
        dash={SELECTION_DASH}
        dashOffset={SELECTION_DASH[0]}
        strokeScaleEnabled={false}
      />
    </>
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

const Crosshair = memo(
  forwardRef(({ width, height }, ref) => {
    const [x, setX] = useState(100);
    const [y, setY] = useState(50);
    const [visible, setVisible] = useState(false);

    if (ref) {
      ref.current = {
        updatePointer(newX, newY) {
          setX(newX);
          setY(newY);
        },
        updateVisibility(visibility) {
          setVisible(visibility);
        },
      };
    }

    if (!visible) return null;

    return (
      <div
        style={{
          opacity: 0.6,
          pointerEvents: "none",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 999,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: y,
            width: "100%",
            height: "1px",
            background: "#fff",
            borderTop: "1px dashed #000",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: x,
            top: 0,
            width: "1px",
            height: "100%",
            background: "#fff",
            borderLeft: "1px dashed #000",
          }}
        />
      </div>
    );
  })
);

const GridOverlay = observer(({ item }) => {
  if (!item.grid || !item.sizeUpdated) return null;

  return (
    <div id="grid-overlay"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundImage: `
          linear-gradient(to right, ${item.gridcolor}15 1px, transparent 1px),
          linear-gradient(to bottom, ${item.gridcolor}15 1px, transparent 1px)
        `,
        backgroundSize: `${item.gridsize}px ${item.gridsize}px`,
        pointerEvents: "none",
        zIndex: 1001,
      }}
    />
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

      if (this.viewerRef.current) {
        this.viewerRef.current.destroy();
      }

      
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
                {}
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

    //KONVA COMPATIBILITY FOR LABEL STUDIO

    // //so zoom.jsx doesnt break
    // container() {
    //   // Return the OSD container DOM node by id or ref
    //   console.log("Called container placeholder")
    //   return document.getElementById(`openseadragon-${this.props.item.name}`);
    // }

    // setCursor(cursor) {
    //   console.log("Called cursor placeholder")
    //   const container = this.container();
    //   if (container) container.style.cursor = cursor;
    // }

    //i think this has to go in the model

    // handleZoom(val) {
    //   console.log("Called seadragon handle zoom")
    //   if(this.viewerRef){
    //     if (this.viewerRef.current) {
    //       const vp = this.viewerRef.current.viewport;
    //       vp.zoomTo(vp.getZoom() + val * 0.2); // Adjust step size as needed
    //     }
    //   }

    // sizeToFit() {
    //   console.log("Called size to fit")
    //   if (this.viewerRef.current) {
    //     this.viewerRef.current.viewport.goHome();
    //   }
    // }

    // sizeToOriginal() {
    //   console.log("Called size to original")
    //   if (this.viewerRef.current) {
    //     this.viewerRef.current.viewport.zoomTo(1);
    //   }
    //}
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
  let stageRef = useRef(null)
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


  const handleOSDkeyEvent = (type) => (e) => {
    console.log("Key event: ",e)
  }

  const handleOSDEvent = (type) => (e) => {
    const viewport = viewerRef.current.viewport;
    const viewportPos = viewport.pointFromPixel(e.position)
    //outside of image
    if(viewportPos.x < 0 || viewportPos.y < 0 || viewportPos.x > 1 || viewportPos.y > 1){
      return
    }
    console.log("Viewport pos: ",viewportPos, " Event: ",e)

    if(type=="doubleclick"){//because LS cant deal with double clicks apparently?
      item.event("dblclick", e.originalEvent, viewportPos.x, viewportPos.y);//this goes to image.js 
v   }
    item.event(type, e.originalEvent, viewportPos.x, viewportPos.y);//this goes to image.js 

    if(e.originalEvent.shiftKey){
      if(type=="drag"){
        console.log("Shift + dragging")
      }
      if(type=="click"){
        console.log("shift click")
      }
      if(type=="double-click"){
        console.log("Shift double click")
      }
    }

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
        if ((!stageRef.current || !originOffsetRef.current || !viewerRef.current || !visibleOffsetRef.current)) return


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

        stageRef.current.width(bound_width_window);
        stageRef.current.height(bound_height_window);
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

        stageRef.current.scale({ x: scaleX, y: scaleY });
        stageRef.current.position({ x: -scaleX* stage_content_internal_resolution.x*tlBound.current.x, y: -scaleY*stage_content_internal_resolution.y*tlBound.current.y }); // top-left corner as origin
        stageRef.current.batchDraw();

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

      viewerRef.current.addHandler("canvas-click", handleOSDEvent('click'));
      viewerRef.current.addHandler("canvas-drag", handleOSDEvent('drag'));
      viewerRef.current.addHandler("canvas-double-click", handleOSDEvent('double-click'));
      viewerRef.current.addHandler("canvas-drag-end", handleOSDEvent('drag-end'));
      
      //we can get modifier already, but i guess if we wanted a hotkey
      //viewerRef.current.addHandler("canvas-key", handleOSDkeyEvent('canvas-key'));

    }
    return () => {
    }
  }, [viewerRef.current]);

  return (
    <div id="EntireStage">
      
      <div id="origin-offset" ref={originOffsetRef} style={{
      // zIndex: 1000,
      // pointerEvents: 'none',
      width:"100%",
      height:"100%"
      }}>

      {/* <div    checking to see if event position matches viewport position
        ref={indicatorRef}
        style={{
          position: "relative",
          left: "0%",
          top: "95%",
          width: "10px",
          height: "10px",
          backgroundColor: "blue",
        }}
      /> */}

        {/* {originOffsetRef.current && <>
        <div style={{ position: "absolute", left: 0, top: 0, width: "5%", height: "5%", backgroundColor: "purple" }} />
        <div style={{ position: "absolute", left: "95%", top: 0, width: "5%", height: "5%", backgroundColor: "green" }} />
        <div style={{ position: "absolute", left: 0, top: "95%", width: "5%", height: "5%", backgroundColor: "blue" }} />
        <div style={{ position: "absolute", left: "95%", top: "95%", width: "5%", height: "5%", backgroundColor: "yellow" }} />
        </>} */}
        
      <div id="visible-offset" ref={visibleOffsetRef}
        style={{
        zIndex: 1015,
        pointerEvents: 'auto',
        width:"100%",
        height:"100%"
      }}>
{/* 
        <div style={{ position: "absolute", left: 0, top: 0, width: "10px", height: "10px", backgroundColor: "red", border: "1px solid green", boxsizing:"border-box"}} /> */}
{/* 
        <GridOverlay item={item} /> */}

      {/* <CanvasOverlay item={item} /> */}

      {/* {originOffsetRef.current && 
      <Stage ref={stageRef} width={100} height={100}>
        <Layer>
        <Rect
          x={45}
          y={45}
          width={10}
          height={10}
          stroke="black"
          strokeWidth={1}
          fillEnabled={false}
          />
          <Rect x={95} y={95} width={5} height={5} fill="white" />
        </Layer>
      </Stage>} */}
      
      <Stage
      ref={(ref) => {
          stageRef.current = ref;     
          item.setStageRef(ref);
          }}
          className={[item.styles?.['image-element'], ...imagePositionClassnames].join(' ')}
        width={10}
        height={10}
        // x={0}
        // y={0}
        // scaleX={1}
        // scaleY={1}
        //these are now handled by openseadragon
        // onClick={handleCanvasEvent('click')}
        // onMouseDown={handleCanvasEvent('mousedown')}
        // onMouseMove={handleCanvasEvent('mousemove')}
        // onMouseUp={handleCanvasEvent('mouseup')}
        >
        
        <StageContent item={item} store={store} state={state} crosshairRef={crosshairRef} />
        
        </Stage>

        {/*
      */}
    </div>{/*visible div*/}
  </div>{/*offset div*/}
    
    {/* {!originOffsetRef.current && 
    <div style={{ color: "red", fontSize: "14px" }}>No origin offset!</div>
    }
    {!viewerRef.current && 
    <div style={{ color: "red", fontSize: "14px" }}>No viewer!</div>
    }
    {!stageRef.current && 
    <div style={{ color: "red", fontSize: "14px" }}>No stage!</div>
    }
    { 
    <div style={{ color: "red", fontSize: "14px" }}>Hotel: Trivago!</div>
    } */}
    </div>//entire stage
  );
});


// const TRANSFORMER_BACK_ID = "transformer_back";

// const TransformerBack = observer(({ item }) => {
//   const { selectedRegionsBBox } = item;
//   const singleNodeMode = item.selectedRegions.length === 1;
//   const dragStartPointRef = useRef({ x: 0, y: 0 });

//   return (
//     <Layer>
//       {selectedRegionsBBox && !singleNodeMode && (
//         <Rect
//           id={TRANSFORMER_BACK_ID}
//           fill="rgba(0,0,0,0)"
//           draggable
//           onClick={() => {
//             item.annotation.unselectAreas();
//           }}
//           onMouseOver={(ev) => {
//             if (!item.annotation.isLinkingMode) {
//               //ev.target.getStage().container().style.cursor = Constants.POINTER_CURSOR;

//               if (typeof ev.target.getStage().container() === "function") {
//                 ev.target.getStage().container().style.cursor = Constants.POINTER_CURSOR;
//               }
//               else{
//                 ev.target.getStage().container.style.cursor = Constants.POINTER_CURSOR;
//               }
//             }
//           }}
//           onMouseOut={(ev) => {
//             ev.target.getStage().container().style.cursor = Constants.DEFAULT_CURSOR;
//           }}
//           onDragStart={(e) => {
//             dragStartPointRef.current = {
//               x: item.canvasToInternalX(e.target.getAttr("x")),
//               y: item.canvasToInternalY(e.target.getAttr("y")),
//             };
//           }}
//           dragBoundFunc={(pos) => {
//             let { x, y } = pos;
//             const { top, left, right, bottom } = item.selectedRegionsBBox;
//             const { stageHeight, stageWidth } = item;

//             const offset = {
//               x: dragStartPointRef.current.x - left,
//               y: dragStartPointRef.current.y - top,
//             };

//             x -= offset.x;
//             y -= offset.y;

//             const bbox = { x, y, width: right - left, height: bottom - top };

//             const fixed = fixRectToFit(bbox, stageWidth, stageHeight);

//             if (fixed.width !== bbox.width) {
//               x += (fixed.width - bbox.width) * (fixed.x !== bbox.x ? -1 : 1);
//             }

//             if (fixed.height !== bbox.height) {
//               y += (fixed.height - bbox.height) * (fixed.y !== bbox.y ? -1 : 1);
//             }

//             x += offset.x;
//             y += offset.y;
//             return { x, y };
//           }}
//         />
//       )}
//     </Layer>
//   );
// });

const StageContent = observer(({ item, store, state, crosshairRef }) => {
  if (!isAlive(item)) {
    console.log("Not alive?")
    return null;
  }
  if (!store.task || !item.currentSrc) {
    console.log("No task or no source")
    return null;
  }
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

  // const imageTopLeft = item.viewerRef.current.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0));
  // const imageBottomRight = item.viewerRef.current.viewport.pixelFromPoint(new OpenSeadragon.Point(1, 1));

  // const width = imageBottomRight.x - imageTopLeft.x 
  // const height = imageBottomRight.y- imageTopLeft.y 

  return (
    <>
      {/* Hack to keep stage in place when there's no regions */}
      {regions.length === 0 && (
        <Layer>
          <Line points={[0, 0, 0, 1]} stroke="rgba(0,0,0,0)" />
        </Layer>
      )}

      {/*
      {isFF(FF_LSDV_4930) ? <TransformerBack item={item} /> : null}
      */}

      {renderableRegions.map(([groupName, list]) => {
        const isBrush = groupName.match(/brush/i) !== null;
        const isSuggestion = groupName.match("suggested") !== null;

        return list.length > 0 ? (
          <Regions
            key={groupName}
            name={groupName}
            regions={list}
            useLayers={true}
            suggestion={isSuggestion}
          />
        ) : (
          <Fragment key={groupName} />
        );
        })
      }
      {/*
      */}
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
