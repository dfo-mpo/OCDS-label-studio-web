import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import BaseTool from "./Base";
import Constants from "../core/Constants";
import ToolMixin from "../mixins/Tool";

import { Tool } from "../components/Toolbar/Tool";
import { Range } from "../common/Range/Range";
import { IconSaturateTool } from "@humansignal/icons";

const ToolView = observer(({ item }) => {
  return (
    <Tool
      active={item.selected}
      ariaLabel="saturation"
      label="Saturation"
      controlsOnHover
      controls={[
        <Range
          key="saturation"
          align="vertical"
          reverse
          continuous
          minIcon={<IconSaturateTool style={{ width: 22, height: 22, filter: "saturate(0%)" }} />}
          maxIcon={<IconSaturateTool style={{ width: 22, height: 22 }} />}
          value={item.saturation}
          max={Constants.SATURATION_MAX}
          onChange={(val) => {
            item.setStroke(val);
          }}
        />,
      ]}
      icon={<IconSaturateTool title="Saturation"/>}
    />
  );
});

const _Tool = types
  .model("SaturationTool", {
    saturation: types.optional(types.number, Constants.SATURATION_VALUE),
  })
  .views((self) => ({
    get viewClass() {
      return () => <ToolView item={self} />;
    },
  }))
  .actions((self) => ({
    setStroke(val) {
      self.saturation = val;
      self.obj.setSaturationGrade(val);
    },
  }));

const Saturation = types.compose(_Tool.name, ToolMixin, BaseTool, _Tool);

export { Saturation };
