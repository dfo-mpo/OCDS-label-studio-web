import { useState } from "react";
import { Modal } from "../../../components/Modal/Modal";
import { Button } from "../../../components";
import { Space } from "../../../components/Space/Space";
import { Elem } from "../../../utils/bem";

export const ConfigModal = ({ visible, onClose, configData }) => {
  return (
    <Modal
      title="Import Configuration"
      onHide={onClose}
      closeOnClickOutside={true}
      visible={visible}
    >
      <Modal.Header divided>
        <Elem block="modal" name="title">
          Import Configuration
        </Elem>
        <Space>
          <Button onClick={onClose}>
            Close
          </Button>
        </Space>
      </Modal.Header>
      
      <Modal.Body>
        <div style={{ padding: '20px' }}>
          <h3>Labels Configuration:</h3>
          {configData?.labels?.map((label, index) => (
            <div key={index} style={{ 
              marginBottom: '15px', 
              padding: '10px', 
              border: '1px solid #ddd', 
              borderRadius: '4px',
              backgroundColor: '#f9f9f9'
            }}>
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                fontSize: '12px',
                margin: 0,
                fontFamily: 'monospace'
              }}>
                {label}
              </pre>
            </div>
          ))}
        </div>
      </Modal.Body>
    </Modal>
  );
};