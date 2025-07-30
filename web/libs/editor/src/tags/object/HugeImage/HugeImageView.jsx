/* import React, { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import ObjectTag from "../../../components/Tags/Object";
import OpenSeadragon from "openseadragon";

const HugeImageView = observer(({ item }) => {
  const viewerRef = useRef(null);
  const viewerId = "openseadragon-viewer";

  useEffect(() => {
    if (!viewerRef.current) {
      viewerRef.current = OpenSeadragon({
        id: viewerId,
        prefixUrl: "https://openseadragon.github.io/openseadragon/images/", // toolbar icons
        tileSources: "http://20.220.26.156:8080/dzi/3/SABLE_ISLAND.dzi", // actual .dzi file
        showNavigator: true,
        maxZoomPixelRatio: Infinity,
      });
    }
    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [item.currentSrc]);

  return (
    <ObjectTag item={item}>
      <div style={{ height: "400px" }}>
        <div id={viewerId} style={{ width: "100%", height: "100%" }} />
      </div>
    </ObjectTag>
  );
});

export { HugeImageView };
 */


