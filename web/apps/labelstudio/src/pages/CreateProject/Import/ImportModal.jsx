import { useCallback, useRef, useState } from "react";
import { useHistory } from "react-router";
import { Button } from "../../../components";
import { Modal } from "../../../components/Modal/Modal";
import { Space } from "../../../components/Space/Space";
import { useAPI } from "../../../providers/ApiProvider";
import { ProjectProvider, useProject } from "../../../providers/ProjectProvider";
import { useFixedLocation } from "../../../providers/RoutesProvider";
import { Elem } from "../../../utils/bem";
import { useRefresh } from "../../../utils/hooks";
import { ImportPage } from "./Import";
import { useImportPage } from "./useImportPage";

import { ConfigModal } from "./ConfigModal";

export const Inner = () => {
  const history = useHistory();
  const location = useFixedLocation();
  const modal = useRef();
  const refresh = useRefresh();
  const { project } = useProject();
  const [waiting, setWaitingStatus] = useState(false);
  const [sample, setSample] = useState(null);
  const api = useAPI();

  // const [showConfigModal, setShowConfigModal] = useState(false);
  // const [configData, setConfigData] = useState(null);

  const { uploading, uploadDisabled, finishUpload, fileIds, pageProps, uploadSample } = useImportPage(project);

  const backToDM = useCallback(() => {
    console.log("backToDM")
    const path = location.pathname.replace(ImportModal.path, "");  
    const search = location.search;
    const pathname = `${path}${search !== "?" ? search : ""}`;

    return refresh(pathname);
  }, [location, history]);

  const onCancel = useCallback(async () => {
    setWaitingStatus(true);
    await api.callApi("deleteFileUploads", {
      params: {
        pk: project.id,
      },
      body: {
        file_upload_ids: fileIds,
      },
    });
    setWaitingStatus(false);
    modal?.current?.hide();
    backToDM();
  }, [modal, project, fileIds, backToDM]);

  const onFinish = useCallback(async () => {
    if (sample) {
      await uploadSample(
        sample,
        () => setWaitingStatus(true),
        () => setWaitingStatus(false),
      );
    }

    const imported = await finishUpload();

    if (imported && imported.labels && imported.labels.length>0){
      // Close the Import modal first

      // Then open the config modal with imported data and onClose handler
      backToDM()
      ConfigModal(imported.labels[0], backToDM);
    }
    else{
      modal.current?.hide();
      backToDM()
    }
    
  }, [backToDM, finishUpload, sample, ConfigModal]);

  return (
    // <div>
    <Modal
      title="Import data"
      ref={modal}
      //onHide={() => backToDM()}
      closeOnClickOutside={false}
      fullscreen
      visible //={!showConfigModal} 
      bare
      style={{ backgroundColor: '#FFFFFF' }}
    >
      <Modal.Header divided>
        <Elem block="modal" name="title">
          Import Data
        </Elem>

        <Space>
          <Button waiting={waiting} onClick={onCancel}>
            Cancel
          </Button>
          <Button look="primary" onClick={onFinish} waiting={waiting || uploading} disabled={uploadDisabled}>
            Import
          </Button>
        </Space>
      </Modal.Header>
      <ImportPage
        project={project}
        sample={sample}
        onSampleDatasetSelect={setSample}
        projectConfigured={Object.keys(project.parsed_label_config ?? {}).length > 0}
        openLabelingConfig={() => {
          history.push(`/projects/${project.id}/settings/labeling`);
        }}
        {...pageProps}
      />
      {/* <ConfigModal 
          visible={showConfigModal} 
          onClose={onConfigModalClose} 
          configData={configData} 
        /> */}
    </Modal>
    // </div>
  );
};
export const ImportModal = () => {
  return (
    <ProjectProvider>
      <Inner />
    </ProjectProvider>
  );
};

ImportModal.path = "/import";
ImportModal.modal = true;
