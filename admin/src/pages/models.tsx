import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { Create, CreateButton, Edit, EditButton, List, useForm } from "@refinedev/antd";
import { Alert, AutoComplete, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAdminTable } from "./common";
import {
    ASR_LANGUAGES,
    FUNCTION_OPTIONS,
    functionLabel,
    IMAGE_SIZES,
    NAME_PREFIX,
    PRICING_UNITS,
    PROVIDER_OPTIONS,
    pricingText,
    VENDORS,
} from "./modelForm";

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
                    { title: "类型", dataIndex: "provider", render: (p) => PROVIDER_OPTIONS[p]?.label.split("（")[0] ?? p },
                    { title: "上游模型", dataIndex: ["providerConfig", "model"], render: (m) => m || "-" },
                    { title: "功能", dataIndex: "functions", render: (f) => Object.keys(f ?? {}).map((k) => <Tag key={k}>{functionLabel(k)}</Tag>) },
                    { title: "计价", dataIndex: "pricing", render: pricingText },
                    { title: "状态", dataIndex: "enabled", render: (e) => (e ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
                    { title: "操作", render: (_, r) => <EditButton size="small" recordItemId={r.id} /> },
                ]}
            />
        </List>
    );
};

const DEFAULTS = {
    enabled: true,
    version: "1.0",
    vendor: "siliconflow",
    baseUrl: VENDORS[0].baseUrl,
    pricingType: "per_call",
    amount: 50,
    unit: "char",
    functionList: [],
    imageSize: undefined,
    dialect: "",
    audioFormat: "mp3",
    language: "",
    responseFormat: "verbose_json",
    extraParams: [],
};

const ModelForm = ({ formProps, editing }: { formProps: any; editing: boolean }) => {
    const form = formProps.form;
    const [providers, setProviders] = useState<string[]>([]);
    useEffect(() => {
        api<{ records: string[] }>("admin/model/providers").then((r) => setProviders(r.records)).catch(() => undefined);
    }, []);

    const provider: string = Form.useWatch("provider", form) ?? "";
    const vendor: string = Form.useWatch("vendor", form) ?? "custom";
    const upstreamModel: string = Form.useWatch("upstreamModel", form) ?? "";
    const pricingType: string = Form.useWatch("pricingType", form) ?? "per_call";
    const functionList: string[] = Form.useWatch("functionList", form) ?? [];
    const responseFormat: string = Form.useWatch("responseFormat", form) ?? "verbose_json";

    const vendorInfo = VENDORS.find((v) => v.value === vendor);
    const modelOptions = (vendorInfo?.models[provider] ?? []).map((m) => ({ value: m }));
    const voiceOptions = (vendorInfo?.voices?.(upstreamModel) ?? []).map((v) => ({ value: v, label: v }));
    const isReal = provider && provider !== "mock";

    // 选类型后自动勾上对应功能；选厂商后自动填接口地址
    const onProviderChange = (p: string) => {
        if (!(form.getFieldValue("functionList") ?? []).length) {
            form.setFieldValue("functionList", PROVIDER_OPTIONS[p]?.functions ?? []);
        }
        if (p === "openai-tts" || p === "openai-asr") {
            form.setFieldsValue({ pricingType: "per_unit", unit: p === "openai-tts" ? "char" : "minute", amount: p === "openai-tts" ? 1 : 10 });
        }
    };
    const onVendorChange = (v: string) => {
        const info = VENDORS.find((x) => x.value === v);
        if (info) form.setFieldValue("baseUrl", info.baseUrl);
    };

    return (
        <Form {...formProps} layout="vertical" initialValues={{ ...DEFAULTS, ...formProps.initialValues }}>
            <Form.Item name="_otherConfig" hidden>
                <Input />
            </Form.Item>
            <Form.Item name="_functionsRaw" hidden>
                <Input />
            </Form.Item>

            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            name="nameSuffix"
                            label="模型名称"
                            rules={[{ required: true, message: "请填写模型名称" }, { pattern: /^[A-Za-z0-9_-]+$/, message: "只能包含字母、数字、下划线、短横线" }]}
                            extra="内部标识，保存后不可修改。客户端看到的是下面的「显示名」。"
                        >
                            <Input addonBefore={NAME_PREFIX} disabled={editing} placeholder="Kolors" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="version" label="版本" rules={[{ required: true }]}>
                            <Input disabled={editing} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="title" label="显示名" rules={[{ required: true, message: "请填写显示名" }]}>
                            <Input maxLength={50} placeholder="例如：Kolors 文生图" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </Col>
                    <Col span={24}>
                        <Form.Item name="description" label="简介">
                            <Input.TextArea rows={2} maxLength={300} />
                        </Form.Item>
                    </Col>
                </Row>
            </Card>

            <Card size="small" title="接入方式（只保存在服务端，不会下发客户端）" style={{ marginBottom: 16 }}>
                {editing && (
                    <Alert style={{ marginBottom: 16 }} type="info" showIcon message="密钥不修改就会保留原值；需要更换时直接填写新密钥。" />
                )}
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item name="provider" label="模型类型" rules={[{ required: true, message: "请选择模型类型" }]}>
                            <Select
                                placeholder="请选择"
                                onChange={onProviderChange}
                                options={providers.map((p) => ({ value: p, label: PROVIDER_OPTIONS[p]?.label ?? p }))}
                            />
                        </Form.Item>
                    </Col>
                    {isReal && (
                        <Col xs={24} md={12}>
                            <Form.Item name="vendor" label="厂商">
                                <Select
                                    onChange={onVendorChange}
                                    options={[...VENDORS.map((v) => ({ value: v.value, label: v.label })), { value: "custom", label: "其他（手动填写接口地址）" }]}
                                />
                            </Form.Item>
                        </Col>
                    )}
                </Row>
                {isReal && (
                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item name="baseUrl" label="接口地址" rules={[{ required: true, message: "请填写接口地址" }]} extra="填到 /v1 为止即可">
                                <Input placeholder="https://api.example.com/v1" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="apiKey" label="API 密钥" rules={[{ required: true, message: "请填写 API 密钥" }]}>
                                <Input.Password placeholder="sk-..." autoComplete="new-password" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="upstreamModel" label="上游模型名" rules={[{ required: true, message: "请填写上游模型名" }]} extra={modelOptions.length ? "可从下拉选择常用模型，也可直接输入" : "厂商控制台里的模型名称"}>
                                <AutoComplete options={modelOptions} placeholder="例如 Qwen/Qwen3-8B" filterOption={(i, o) => String(o?.value).toLowerCase().includes(i.toLowerCase())} />
                            </Form.Item>
                        </Col>

                        {provider === "openai-chat" && (
                            <Col xs={24} md={12}>
                                <Form.Item name="disableThinking" label="关闭深度思考" valuePropName="checked" extra="Qwen3 等思考模型建议开启：回答更快，不会被思考过程截断">
                                    <Switch />
                                </Form.Item>
                            </Col>
                        )}

                        {provider === "openai-image" && (
                            <>
                                <Col xs={24} md={12}>
                                    <Form.Item name="imageSize" label="默认尺寸" extra="客户端没有指定宽高时使用">
                                        <Select allowClear placeholder="1024x1024" options={IMAGE_SIZES.map((s) => ({ value: s, label: s }))} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="dialect" label="接口格式">
                                        <Select
                                            options={[
                                                { value: "", label: "自动判断（地址含 siliconflow 时按硅基流动格式）" },
                                                { value: "openai", label: "OpenAI 格式" },
                                                { value: "siliconflow", label: "硅基流动格式" },
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                            </>
                        )}

                        {provider === "openai-tts" && (
                            <>
                                <Col xs={24} md={12}>
                                    <Form.Item name="audioFormat" label="音频格式">
                                        <Select options={[{ value: "mp3", label: "mp3" }, { value: "wav", label: "wav" }]} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="voices" label="可选音色" extra="客户端合成时可在这些音色里选择；可从下拉选，也可输入后回车添加">
                                        <Select mode="tags" options={voiceOptions} placeholder="选择或输入音色" tokenSeparators={[",", "，"]} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="voice" label="默认音色">
                                        <AutoComplete options={voiceOptions} placeholder="不填则用可选音色里的第一个" />
                                    </Form.Item>
                                </Col>
                            </>
                        )}

                        {provider === "openai-asr" && (
                            <>
                                <Col xs={24} md={12}>
                                    <Form.Item name="language" label="识别语言">
                                        <Select options={ASR_LANGUAGES} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name="responseFormat"
                                        label="返回结果"
                                        extra={responseFormat === "json" ? "整段文字作为一条字幕" : "上游不支持分段时（如 SenseVoice）请选「整段文字」"}
                                    >
                                        <Select
                                            options={[
                                                { value: "verbose_json", label: "分段时间轴（Whisper 等）" },
                                                { value: "json", label: "整段文字（SenseVoice 等）" },
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                            </>
                        )}

                        <Col span={24}>
                            <Form.Item label="额外请求参数（一般不用填）" extra="原样附加到上游请求里，例如 num_inference_steps = 20">
                                <Form.List name="extraParams">
                                    {(fields, { add, remove }) => (
                                        <>
                                            {fields.map((f) => (
                                                <Space key={f.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                                                    <Form.Item name={[f.name, "key"]} noStyle>
                                                        <Input placeholder="参数名" style={{ width: 200 }} />
                                                    </Form.Item>
                                                    <Form.Item name={[f.name, "value"]} noStyle>
                                                        <Input placeholder="值" style={{ width: 200 }} />
                                                    </Form.Item>
                                                    <MinusCircleOutlined onClick={() => remove(f.name)} />
                                                </Space>
                                            ))}
                                            <Button type="dashed" onClick={() => add({ key: "", value: "" })} icon={<PlusOutlined />}>
                                                添加参数
                                            </Button>
                                        </>
                                    )}
                                </Form.List>
                            </Form.Item>
                        </Col>
                    </Row>
                )}
            </Card>

            <Card size="small" title="功能与计价" style={{ marginBottom: 16 }}>
                <Row gutter={16}>
                    <Col span={24}>
                        <Form.Item
                            name="functionList"
                            label="在哪些功能里可选"
                            rules={[{ required: true, message: "至少选择一个功能" }]}
                            extra="客户端对应页面的模型下拉框里会出现这个模型"
                        >
                            <Select mode="multiple" options={FUNCTION_OPTIONS} placeholder="选择功能" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="pricingType" label="计价方式">
                            <Select
                                options={[
                                    { value: "per_call", label: "按次" },
                                    { value: "per_token", label: "按 token（文本模型）" },
                                    { value: "per_unit", label: "按数量（字数 / 时长 / 张数）" },
                                ]}
                            />
                        </Form.Item>
                    </Col>
                    {pricingType === "per_token" ? (
                        <>
                            <Col xs={24} md={8}>
                                <Form.Item name="inputPer1k" label="输入每千 token（额度）" rules={[{ required: true }]}>
                                    <InputNumber min={0} style={{ width: "100%" }} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                                <Form.Item name="outputPer1k" label="输出每千 token（额度）" rules={[{ required: true }]}>
                                    <InputNumber min={0} style={{ width: "100%" }} />
                                </Form.Item>
                            </Col>
                        </>
                    ) : (
                        <>
                            {pricingType === "per_unit" && (
                                <Col xs={24} md={8}>
                                    <Form.Item name="unit" label="计量单位">
                                        <Select options={PRICING_UNITS} />
                                    </Form.Item>
                                </Col>
                            )}
                            <Col xs={24} md={8}>
                                <Form.Item name="amount" label={pricingType === "per_unit" ? "每单位扣除额度" : "每次扣除额度"} rules={[{ required: true, message: "请填写额度" }]}>
                                    <InputNumber min={0} style={{ width: "100%" }} />
                                </Form.Item>
                            </Col>
                        </>
                    )}
                </Row>
                {functionList.includes("soundTts") && provider !== "openai-tts" && provider !== "mock" && (
                    <Alert type="warning" showIcon message="语音合成需要选择「语音合成」类型的模型才能调用" />
                )}
            </Card>
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
