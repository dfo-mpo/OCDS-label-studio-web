
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

const RegionsOverlay = memo(({ regions, name, showSelected = false, suggestion = false }) => {
  const content = regions.map((el) => (
    <Region key={`region-${el.id}`} region={el} showSelected={showSelected} />
  ));

  // Inline fallback for missing styles.regionsLayer and styles[name]
  const style = {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    // Add any background or zIndex if needed here
  };

  return (
    <div data-suggestion={suggestion} style={style}>
      {content}
    </div>
  );
});

const Regions = memo(({ regions, chunkSize = 15, suggestion = false, showSelected = false }) => {
  return (
    <ImageViewProvider value={{ suggestion }}>
      {(chunkSize ? chunks(regions, chunkSize) : regions).map((chunk, i) => (
        <RegionsOverlay
          key={`chunk-${i}`}
          name={`chunk-${i}`}
          regions={chunk}
          showSelected={showSelected}
          suggestion={suggestion}
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
        zIndex: 998,
      }}
    />
  );
});

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
        zIndex: 997,
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
        showNavigator: true,//add this to config
        showZoomControl: false,
        showHomeControl: false,
        showFullPageControl: false,
        showRotationControl: item.rotatecontrol,
        maxZoomPixelRatio: Infinity,
        minZoomLevel: item.negativezoom ? 0.1 : 1,
        zoomPerClick: 0,
        zoomPerScroll: item.zoomBy,
        crossOriginPolicy: item.imageCrossOrigin,
        animationTime: 0.5,
        blendTime: 0.1,
        constrainDuringPan: true,
        wrapHorizontal: false,
        wrapVertical: false,
        visibilityRatio: 1,
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
        if (item.setZoomPosition) {
          const center = event.center;
          const viewport = viewer.viewport;
          const containerSize = viewport.getContainerSize();
          const viewportPoint = viewport.viewportToViewerElementCoordinates(center);

          item.setZoomPosition(-viewportPoint.x + containerSize.x / 2, -viewportPoint.y + containerSize.y / 2);
        }
      });

      const handleMouseEvent = (eventType) => (event) => {
        if (item.getSkipInteractions && item.getSkipInteractions()) return;

        const webPoint = event.position;
        const viewportPoint = viewer.viewport.pointFromPixel(webPoint);
        const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);

        const x = imagePoint.x;
        const y = imagePoint.y;

        item.event(eventType, event.originalEvent, x, y);
      };

      viewer.addHandler("canvas-click", handleMouseEvent("click"));
      //viewer.addHandler("canvas-drag", handleMouseEvent("drag"));
      viewer.addHandler("canvas-press", handleMouseEvent("mousedown"));
      viewer.addHandler("canvas-release", handleMouseEvent("mouseup"));


      viewer.addHandler("canvas-drag", (event) => {
        const activeTool = item.manager.activeTool

        if (activeTool?.toolName === "Pan") {
          const deltaPoint = viewer.viewport.deltaPointsFromPixels(event.delta);
          viewer.viewport.panBy(deltaPoint);
          viewer.viewport.applyConstraints();
        }
      });


      viewer.addHandler("canvas-move", (event) => {
        if (item.getSkipInteractions && item.getSkipInteractions()) return;

        const webPoint = event.position;
        const viewportPoint = viewer.viewport.pointFromPixel(webPoint);
        const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);

        if (this.crosshairRef.current) {
          this.crosshairRef.current.updatePointer(webPoint.x, webPoint.y);
        }

        if (item.setPointerPosition) {
          item.setPointerPosition({ x: imagePoint.x, y: imagePoint.y });
        }

        item.event("mousemove", event.originalEvent, imagePoint.x, imagePoint.y);
      });

      viewer.addHandler("canvas-enter", () => {
        if (this.crosshairRef.current) {
          this.crosshairRef.current.updateVisibility(true);
        }
      });

      viewer.addHandler("canvas-exit", () => {
        if (this.crosshairRef.current) {
          this.crosshairRef.current.updateVisibility(false);
        }
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

    getAbsoluteTransform() {
      print("Get absolute transform from sea dragon")
      return this.imageTransform.getAbsoluteTransform()
    }

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
              }}
            />

            {/* Overlays */}
            {item.imageIsLoaded && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  zIndex: 1000,
                }}
              >
                <GridOverlay item={item} />
                <CanvasOverlay item={item} />
                <RegionsContent item={item} />
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
            )}

            {/* Toolbar pinned to top-right */}
            {item.hasTools && item.imageIsLoaded && (
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
      if (this.viewerRef.current) {
        const vp = this.viewerRef.current.viewport;
        vp.zoomTo(vp.getZoom() + val * 0.2); // Adjust step size as needed
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
  if (!isAlive(item)) return null;
  if (!item.currentSrc) return null;

  const regions = item.regs;
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
      {renderableRegions.map(([groupName, list]) => {
        const isSuggestion = groupName.match("suggested") !== null;
        return list.length > 0 ? (
          <Regions key={groupName} regions={list} suggestion={isSuggestion} />
        ) : (
          <Fragment key={groupName} />
        );
      })}
    </>
  );
});