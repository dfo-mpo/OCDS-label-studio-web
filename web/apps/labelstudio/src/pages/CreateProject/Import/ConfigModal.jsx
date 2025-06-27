import React from "react";
import { modal } from "../../../components/Modal/Modal";
import { CopyableTooltip } from "../../../components/CopyableTooltip/CopyableTooltip";

export function configModal(data, closeCallBack) {
  modal({
    title: "Import Summary",
    body: () => (
      <div style={{
        padding: '20px',
        backgroundColor: '#f9f9f9',
        borderRadius: '6px',
        fontSize: '13px',
        maxHeight: '60vh',
        overflow: 'auto',
      }}>
        <CopyableTooltip
          title="Click to copy"
          textForCopy={data}
        >
          <pre style={{
            cursor: "pointer",
            color: "#333",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontFamily: "monospace",
          }}>
            {data}
          </pre>
        </CopyableTooltip>
      </div>
    ),
    style: { width: 600 },
    allowClose: true,
    onClose: () => {
      if (closeCallBack) closeCallBack();
    },
  });
}
