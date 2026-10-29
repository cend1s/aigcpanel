import { Create, CreateButton, Edit, EditButton, List, useForm } from "@refinedev/antd";
import { Alert, Form, Input, Select, Switch, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { api } from "../api";
import { jsonRule, useAdminTable } from "./common";


const PRICING_EXAMPLES = [
    '{"type": "per_call", "amount": 50}                         按次',
    '{"type": "per_token", "inputPer1k": 1, "outputPer1k": 3}   按千 token',
    '{"type": "per_unit", "unit": "second", "amount": 5}       按秒/张等',
].join("\n");

export const ModelList = () => {
    const { tableProps } = useAdminTable("model");
    return (
        <List headerButtons={<CreateButton>新增模型</CreateButton>}>
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "版本", dataIndex: "version" },
                    { title: "显示名", dataIndex: "title" },
                    { title: "供应商", dataIndex: "provider" },
                    { title: "功能", dataIndex: "functions", render: (f) => Object.keys(f ?? {}).map((k) => <Tag key={k}>{k}</Tag>) },
                    { title: "计价", dataIndex: "pricing", render: (p) => <code>{JSON.stringify(p)}</code> },
                    { title: "状态", dataIndex: "enabled", render: (e) => (e ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
                    { title: "操作", render: (_, r) => <EditButton size="small" recordItemId={r.id} /> },
                ]}
            />
        </List>
    );
};

const ModelForm = ({ formProps, editing }: { formProps: any; editing: boolean }) => {
    const [providers, setProviders] = useState<string[]>([]);
    useEffect(() => {
        api<{ records: string[] }>("admin/model/providers").then((r) => setProviders(r.records)).catch(() => undefined);
    }, []);
    return (
        <Form
            {...formProps}
            layout="vertical"
            initialValues={{ enabled: true, version: "1.0", functionsJson: '{\n  "textToImage": {"param": []}\n}', providerConfigJson: '{\n  "baseUrl": "",\n  "apiKey": "",\n  "model": ""\n}', pricingJson: '{"type": "per_call", "amount": 50}', ...formProps.initialValues }}
        >
            {editing && (
                <Alert
                    style={{ marginBottom: 16 }}
                    type="info"
                    showIcon
                    message="密钥类字段显示为脱敏值（******+末四位）。不修改就会保留原密钥；需要更换时直接填写新值。"
                />
            )}
            <Form.Item
                name="name"
                label="模型名称"
                rules={[{ required: true }, { pattern: /^Cloud[A-Za-z0-9_-]*$/, message: "必须以 Cloud 开头，只能包含字母、数字、下划线、短横线" }]}
                extra="桌面端按 Cloud 前缀识别云端模型。名称与版本共同确定一个模型，保存后不可修改。"
            >
                <Input disabled={editing} placeholder="CloudImageGen" />
            </Form.Item>
            <Form.Item name="version" label="版本" rules={[{ required: true }]}>
                <Input disabled={editing} />
            </Form.Item>
            <Form.Item name="title" label="显示名" rules={[{ required: true }]}>
                <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="description" label="简介">
                <Input.TextArea rows={2} maxLength={300} />
            </Form.Item>
            <Form.Item name="provider" label="供应商" rules={[{ required: true }]} extra="由后端注册的供应商适配器决定（见 backend/src/index.ts）">
                <Select options={providers.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item name="providerConfigJson" label="供应商配置（JSON，仅保存在后端，不会下发客户端）" rules={[jsonRule]}>
                <Input.TextArea rows={6} style={{ fontFamily: "monospace" }} />
            </Form.Item>
            <Form.Item name="pricingJson" label="计价规则（JSON）" rules={[{ required: true }, jsonRule]} extra={<pre style={{ margin: 0 }}>{PRICING_EXAMPLES}</pre>}>
                <Input.TextArea rows={2} style={{ fontFamily: "monospace" }} />
            </Form.Item>
            <Form.Item
                name="functionsJson"
                label="功能定义（JSON，下发客户端，决定在哪些页面可选及参数表单）"
                rules={[jsonRule]}
                extra="可用功能：textGen（电商文案）、textToImage、imageToImage、textToVideo、imageToVideo、soundTts（语音合成）、asr（语音识别）"
            >
                <Input.TextArea rows={6} style={{ fontFamily: "monospace" }} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
            </Form.Item>
        </Form>
    );
};

export const ModelCreate = () => {
    const { formProps, saveButtonProps } = useForm({ resource: "model", redirect: "list" });
    return (
        <Create saveButtonProps={saveButtonProps} title="新增云端模型">
            <ModelForm formProps={formProps} editing={false} />
        </Create>
    );
};

export const ModelEdit = () => {
    const { formProps, saveButtonProps } = useForm({ resource: "model", redirect: "list" });
    return (
        <Edit saveButtonProps={saveButtonProps} title="编辑云端模型" canDelete={false}>
            <ModelForm formProps={formProps} editing />
        </Edit>
    );
};
