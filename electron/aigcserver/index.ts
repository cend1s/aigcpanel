
import { ApiServer } from "./ApiServer";
import { CloudServer } from "./CloudServer";
import { ComfyUIServer } from "./comfyui";
import { EasyServer } from "./EasyServer";
import { RemoteServer } from "./RemoteServer";

export const AigcServer = {
    
    ApiServer: ApiServer,
    Cloud: CloudServer,
    ComfyUI: ComfyUIServer,
    EasyServer: EasyServer,
    RemoteServer: RemoteServer,
};
