
import ObjectTag from "../../../components/Tags/Object";
import Tree from "../../../core/Tree";
import styles from "../../../components/ImageView/Image.scss";
import { errorBuilder } from "../../../core/DataValidator/ConfigValidator";
import { chunks } from "../../../utils/utilities";
import { LoadingOutlined } from "@ant-design/icons";
import { Toolbar } from "../../../components/Toolbar/Toolbar";
import { ImageViewProvider } from "../../../components/ImageView/ImageViewContext";
import ResizeObserver from "../../../utils/resize-observer";
import { debounce } from "../../../utils/debounce";
import Constants from "../../../core/Constants";
import { Component, createRef, forwardRef, Fragment, memo, useEffect, useRef, useState } from "react";
import { observer, useObserver } from "mobx-react";
import { getEnv, getRoot, isAlive } from "mobx-state-tree";
import OpenSeadragon from "openseadragon";
import { Group, Layer, Line, Rect, Stage } from "react-konva";
import ImageGrid from "../../../components/ImageGrid/ImageGrid";

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

const SelectionRect = observer(({ item }) => {
  const { selectionArea } = item;
  if (!selectionArea || !selectionArea.start || !selectionArea.end) return null;

  const { start, end } = selectionArea;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return (
    <div
      style={{
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: `2px dashed ${SELECTION_COLOR}`,
        background: "rgba(64, 169, 255, 0.1)",
        pointerEvents: "none",
        zIndex: 1001,
      }}
    />
  );
});

const Selection = observer(({ item }) => {
  return (
    <>
      <SelectionRect item={item} />
      {/* other selection components can be added here */}
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
    <div
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
        prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
        tileSources: "http://20.220.26.156:8080/dzi/3/SABLE_ISLAND.dzi",//item.currentSrc?
        showNavigator: false,//TODO: add this to config
        showZoomControl: false,
        showHomeControl: false,
        showFullPageControl: false,
        showRotationControl: item.rotatecontrol,
        maxZoomPixelRatio: 5,
        minZoomLevel: 0.5,//item.negativezoom ? 0.1 : 1,
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
          dragToPan: false,   
          scrollToZoom: false,
        },
      });

      // ---- Shim Konva-like API ----
      viewer.getAbsoluteTransform = function () {
        return {
          copy() { return this; },
          invert() { return this; },
          point({ x, y }) {
            const p = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x, y));
            return { x: p.x, y: p.y };
          }
        };
      };

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
        //console.log("Pan button")
        if (item.setZoomPosition) {
          const center = event.center;
          const viewport = viewer.viewport;
          const containerSize = viewport.getContainerSize();
          const viewportPoint = viewport.viewportToViewerElementCoordinates(center);

          item.setZoomPosition(-viewportPoint.x + containerSize.x / 2, -viewportPoint.y + containerSize.y / 2);
        }
      });


      const handleMouseEvent = (eventType) => (event) => {
        const webPoint = event.position; // Mouse position in viewer container (includes black bars)
        const viewportPoint = viewer.viewport.pointFromPixel(webPoint); // 0-1 coordinates
        const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint); // Pixel coordinates on image
        
        const imageTopLeft = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0));
        const imageBottomRight = viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(1, 1));

        const width = imageBottomRight.x - imageTopLeft.x 
        const height = imageBottomRight.y- imageTopLeft.y 
        
        // Adjust coordinates to account for margins (black bars)
        const x = webPoint.x - imageTopLeft.x
        const y = webPoint.y - imageTopLeft.y;
        
        console.log("webPoint: ", webPoint
        ,"\imageTopLeft: ", imageTopLeft
        ,"\nimageBottomRight: ", imageBottomRight
        ,"\nAdjusted x, y:", x, y);
        
        // Only trigger event if click is within the inner container (not on black bars)
        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          item.event(eventType, event.originalEvent, x, y);
          //console.log("Click inside image bounds, ignoring");
        } else {
          console.log("Click outside image bounds, ignoring");
        }
      };
      

      // const handleMouseEvent = (eventType) => (event) => {
      //   //if (item.getSkipInteractions && item.getSkipInteractions()) return;

      //   console.log("Mouse event: ", event)
        
      //   const webPoint = event.position;
      //   const viewportPoint = viewer.viewport.pointFromPixel(webPoint);
      //   const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);
        
      //   // var width  = 1.0 / viewer.viewport.getZoom(current);
      //   // var height = viewer.viewportwidth / viewer.viewport.getAspectRatio();


      //   console.log("webPoint: ", webPoint)
      //   console.log("viewportPoint: ", viewportPoint)
      //   console.log("imagePoint: ", imagePoint)
        
      //   const x = webPoint.x
      //   const y = webPoint.y;

      //   //the events offset is out of bounds, so it cancels drawing on the image
      //   //at         if (!self.isAllowedInteraction(ev)) return;
      //   //in drawingtool.js
      //   //either adjust our position to match the canvas size
      //   //or adjust the canvas size variable to understand the image is larger now
      //   //but that might require adjusting other assumptions about canvas size
      //   //so maybe just adjust our offset, and maybe the annotations thing
      //   //they're in 0-1 so thats the same for canvas as for image

      //   //webpoint is the openseadragon component in top left origin, in pixels
      //   //viewportpoint is 0-1 the image
      //   //imagePoint is pixels the image
      //   //theres black bars on the image because its a different aspect ratio than the component itself
      //   //those will have negative or >> height values for imagePoint and viewPoint
      //   //but webpoint is including those bars as well so its fine (its the whole component)
      //   //annotations should be placed with viewportPoint
      //   //the internal canvasSize is maybe acting weird
      //   //can we find a maxImageSize variable or a canvasSizeVariable?

        
      //   item.event(eventType, event.originalEvent, x, y);
      // };

      //the tools have no dragEv
      //and seadragon has no canvas-move ev
      //though perhaps theres one internal if we look harder
      //but there is canvas-drag

      viewer.addHandler("canvas-click", handleMouseEvent("click"));
      viewer.addHandler("canvas-drag", handleMouseEvent("mousemove"));
      viewer.addHandler("canvas-press", handleMouseEvent("mousedown"));
      viewer.addHandler("canvas-release", handleMouseEvent("mouseup"));
      //viewer.addHandler("canvas-move", handleMouseEvent("mousemove"));
      viewer.addHandler("canva-scroll", handleMouseEvent("scroll"));
      viewer.addHandler("canvas-double-click", handleMouseEvent("dblclick"));

      viewer.addHandler('update-viewport', () => {
        // Sync Konva stage transform to match OSD viewport
        item.seadragon_zoom = viewer.viewport.getZoom();
        item.seadragon_pan = viewer.viewport.getCenter();
      });

      if (item.setStageRef) item.setStageRef(viewer);
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
    }


    
    componentWillUnmount() {
      this.detachObserver();
      window.removeEventListener("resize", this.onResize);

      if (this.viewerRef.current) {
        this.viewerRef.current.destroy();
        this.viewerRef.current = null;
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
                everything = {this}
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

    //so zoom.jsx doesnt break
    container() {
      // Return the OSD container DOM node by id or ref
      return document.getElementById(`openseadragon-${this.props.item.name}`);
    }

    setCursor(cursor) {
      const container = this.container();
      if (container) container.style.cursor = cursor;
    }

    handleZoom(val) {
      if(this.viewerRef){
        if (this.viewerRef.current) {
          const vp = this.viewerRef.current.viewport;
          vp.zoomTo(vp.getZoom() + val * 0.2); // Adjust step size as needed
        }
      }
    }

    sizeToFit() {
      if (this.viewerRef.current) {
        this.viewerRef.current.viewport.goHome();
      }
    }


    sizeToOriginal() {
      if (this.viewerRef.current) {
        this.viewerRef.current.viewport.zoomTo(1);
      }
    }

  }
);

const RegionsContent = observer(({ item }) => {
  console.log("Item:", item); // print all at once
  return (
    <svg id="RegionsContent" width="100%" height="100%">
      {item.regs.map((item, index) => (
        <rect
          key={index}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          fill={item.color || "transparent"}
          stroke="black"
        />
      ))}
    </svg>
  );
});

const EntireStage = observer(
  ({
    item,
    everything,
    viewerRef,
    imagePositionClassnames,
    state,
    crosshairRef,
  }) => {
    const { store } = item;
    let size;
    let position;

    // if (!item.viewerRef || !item.viewerRef.current) {
    //   return null
    // }

    if (isFF(FF_ZOOM_OPTIM)) {
      size = {
        width: item.containerWidth,
        height: item.containerHeight,
      };
      position = {
        x: item.zoomingPositionX + item.alignmentOffset.x,
        y: item.zoomingPositionY + item.alignmentOffset.y,
      };
    } else {
      size = { ...item.canvasSize };
      position = {
        x: item.zoomingPositionX,
        y: item.zoomingPositionY,
      };
    }

    let offset_style = {
      position: "absolute",
      top: "0px",
      left: "0px",
      width: "100%",
      height: "100%",
      //overflow: "hidden"
      pointerEvents: "auto",//let clicks pass through
    };

    // It takes one or two render calls, but eventually viewerRef.current does get assigned a value
    
      // if(item.viewerRef){
      //   console.log("Viewer ref IS filled!")
      // }
      
      // if(everything.viewerRef.current){
      //   console.log("its in everything at least")
      // }
      
      
      // if(viewerRef){
      //   console.log("At least we have viewer ref")
      //     if(viewerRef.current){
      //       console.log("Its in viewerref current!")
      //     }
      // }

      if(viewerRef){
        if(viewerRef.current){

          let seadragon = viewerRef.current.viewport

          const image_offset_tl = seadragon.pixelFromPoint(new OpenSeadragon.Point(0, 0));
          const image_offset_br = seadragon.pixelFromPoint(new OpenSeadragon.Point(1, 1));
          
          // In pixels
          const stage_width = image_offset_br.x - image_offset_tl.x;
          const stage_height = image_offset_br.y - image_offset_tl.y;
          
          offset_style = {
            position: "absolute",
            top: `${image_offset_tl.y}px`,
            left: `${image_offset_tl.x}px`,
            width: `${stage_width}px`,
            height: `${stage_height}px`,
            zIndex: 1002,  
            pointerEvents: "auto",//let clicks pass through
          //overflow: "hidden"
          } 
        }
      }
      else{
        console.log("Viewer ref is not filled")
      }
    
    return (
        <div 
          id="origin offset"
          style={offset_style}
        >
        <GridOverlay item={item} />
        <CanvasOverlay item={item} />
        <Stage
          ref={(ref) => {
            item.setStageRef(ref);
          }}
          className={[styles["image-element"], ...imagePositionClassnames].join(" ")}
          width={size.width}
          height={size.height}
          scaleX={item.zoomScale}
          scaleY={item.zoomScale}
          x={position.x}
          y={position.y}
          offsetX={item.stageTranslate.x}
          offsetY={item.stageTranslate.y}
          rotation={item.rotation}
        >
          <StageContent item={item} store={store} state={state} crosshairRef={crosshairRef} />
        </Stage>
      </div>
    );
  },
);

const TRANSFORMER_BACK_ID = "transformer_back";

const TransformerBack = observer(({ item }) => {
  const { selectedRegionsBBox } = item;
  const singleNodeMode = item.selectedRegions.length === 1;
  const dragStartPointRef = useRef({ x: 0, y: 0 });

  return (
    <Layer>
      {selectedRegionsBBox && !singleNodeMode && (
        <Rect
          id={TRANSFORMER_BACK_ID}
          fill="rgba(0,0,0,0)"
          draggable
          onClick={() => {
            item.annotation.unselectAreas();
          }}
          onMouseOver={(ev) => {
            if (!item.annotation.isLinkingMode) {
              //ev.target.getStage().container().style.cursor = Constants.POINTER_CURSOR;

              if (typeof ev.target.getStage().container() === "function") {
                ev.target.getStage().container().style.cursor = Constants.POINTER_CURSOR;
              }
              else{
                ev.target.getStage().container.style.cursor = Constants.POINTER_CURSOR;
              }
            }
          }}
          onMouseOut={(ev) => {
            ev.target.getStage().container().style.cursor = Constants.DEFAULT_CURSOR;
          }}
          onDragStart={(e) => {
            dragStartPointRef.current = {
              x: item.canvasToInternalX(e.target.getAttr("x")),
              y: item.canvasToInternalY(e.target.getAttr("y")),
            };
          }}
          dragBoundFunc={(pos) => {
            let { x, y } = pos;
            const { top, left, right, bottom } = item.selectedRegionsBBox;
            const { stageHeight, stageWidth } = item;

            const offset = {
              x: dragStartPointRef.current.x - left,
              y: dragStartPointRef.current.y - top,
            };

            x -= offset.x;
            y -= offset.y;

            const bbox = { x, y, width: right - left, height: bottom - top };

            const fixed = fixRectToFit(bbox, stageWidth, stageHeight);

            if (fixed.width !== bbox.width) {
              x += (fixed.width - bbox.width) * (fixed.x !== bbox.x ? -1 : 1);
            }

            if (fixed.height !== bbox.height) {
              y += (fixed.height - bbox.height) * (fixed.y !== bbox.y ? -1 : 1);
            }

            x += offset.x;
            y += offset.y;
            return { x, y };
          }}
        />
      )}
    </Layer>
  );
});

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

      {/*DEBUG: disabled transformer back*/}
      {isFF(FF_LSDV_4930) ? <TransformerBack item={item} /> : null}

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
