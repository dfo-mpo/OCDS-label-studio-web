import { observer } from "mobx-react";
import { types } from "mobx-state-tree";

import BaseTool from "./Base";
import Constants from "../core/Constants";
import ToolMixin from "../mixins/Tool";

import { Tool } from "../components/Toolbar/Tool";
import { IconInvertTool } from "@humansignal/icons";

const INVERTED = 100
const REGULAR = 0

// UI Component: Simple toggle button
const ToolView = observer(({ item }) => {
  const toggleInvert = () => {
    const newVal = item.invert === REGULAR ? INVERTED : REGULAR;
    item.setStroke(newVal);
  };

  return (
    <Tool
      active={item.invert > 0}
      ariaLabel="invert"
      label="Invert"
      icon={<IconInvertTool style={{ opacity: 0.8 }} />}
      onClick={toggleInvert}
    />
  );
});

const _Tool = types
  .model("InvertTool", {
    invert: types.optional(types.number, 0),
  })
  .views((self) => ({
    get viewClass() {
      return () => <ToolView item={self} />;
    },
  }))
  .actions((self) => ({
    setStroke(val) {
      self.invert = val;
      self.obj.setInvertGrade(val);
    },
  }));

// Compose final tool
const Invert = types.compose(_Tool.name, ToolMixin, BaseTool, _Tool);

export { Invert };
