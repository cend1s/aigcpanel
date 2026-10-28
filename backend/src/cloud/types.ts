import type { Usage } from "./pricing.js";

export type ModelRow = {
    id: number;
    name: string;
    version: string;
    title: string;
    provider: string;
    providerConfig: Record<string, any>;
    pricing: any;
    enabled: boolean;
};

export type SubmitResult =
    | { kind: "done"; result: unknown; usage?: Usage }
    | { kind: "async"; upstreamId: string };

export type QueryResult =
    | { status: "running" }
    | { status: "succeeded"; result: unknown; usage?: Usage }
    | { status: "failed"; error: string };

// 云端模型供应商接口：新增一家厂商只需实现并注册，不影响计费与任务状态机。
export interface CloudProvider {
    readonly name: string;
    submit(model: ModelRow, param: any): Promise<SubmitResult>;
    query(model: ModelRow, upstreamId: string): Promise<QueryResult>;
}

export class ProviderRegistry {
    private map = new Map<string, CloudProvider>();
    register(p: CloudProvider) {
        this.map.set(p.name, p);
        return this;
    }
    get(name: string): CloudProvider | undefined {
        return this.map.get(name);
    }
    names() {
        return [...this.map.keys()];
    }
}
