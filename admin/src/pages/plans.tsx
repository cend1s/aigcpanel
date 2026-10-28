import { Create, CreateButton, Edit, EditButton, List, useForm } from "@refinedev/antd";
import { Form, Input, InputNumber, Switch, Table, Tag } from "antd";
import { yuan } from "../format";
import { jsonRule, useAdminTable } from "./common";

export const PlanList = () => {
    const { tableProps } = useAdminTable("plan");
    return (
        <List headerButtons={<CreateButton>新建套餐</CreateButton>}>
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "ID", dataIndex: "id", width: 70 },
                    { title: "名称", dataIndex: "title" },
                    { title: "价格", dataIndex: "priceCents", render: yuan },
                    { title: "有效天数", dataIndex: "durationDays" },
                    { title: "包含额度", dataIndex: "quota" },
                    { title: "功能权限", dataIndex: "functions", render: (f) => Object.keys(f ?? {}).map((k) => <Tag key={k}>{k}</Tag>) },
                    { title: "状态", dataIndex: "enabled", render: (e) => (e ? <Tag color="green">上架</Tag> : <Tag>下架</Tag>) },
                    { title: "排序", dataIndex: "sort" },
                    { title: "操作", render: (_, r) => <EditButton size="small" recordItemId={r.id} /> },
                ]}
            />
        </List>
    );
};

const PlanForm = ({ formProps }: { formProps: any }) => (
    <Form {...formProps} layout="vertical" initialValues={{ enabled: true, sort: 0, durationDays: 30, functionsJson: "{}", ...formProps.initialValues }}>
        <Form.Item name="title" label="名称" rules={[{ required: true }]}>
            <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="subtitle" label="副标题">
            <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="priceYuan" label="价格（元）" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="durationDays" label="有效天数" rules={[{ required: true }]}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="quota" label="包含额度" rules={[{ required: true }]}>
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
            name="functionsJson"
            label="功能权限（JSON，下发到客户端 user_info.data.functions）"
            rules={[jsonRule]}
            extra='例如 {"videoGen": true}；留空对象表示只提供额度'
        >
            <Input.TextArea rows={4} style={{ fontFamily: "monospace" }} />
        </Form.Item>
        <Form.Item name="sort" label="排序（小的在前）">
            <InputNumber precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="enabled" label="上架" valuePropName="checked">
            <Switch />
        </Form.Item>
    </Form>
);

export const PlanCreate = () => {
    const { formProps, saveButtonProps } = useForm({ resource: "plan", redirect: "list" });
    return (
        <Create saveButtonProps={saveButtonProps} title="新建套餐">
            <PlanForm formProps={formProps} />
        </Create>
    );
};

export const PlanEdit = () => {
    const { formProps, saveButtonProps } = useForm({ resource: "plan", redirect: "list" });
    return (
        <Edit saveButtonProps={saveButtonProps} title="编辑套餐" canDelete={false}>
            <PlanForm formProps={formProps} />
        </Edit>
    );
};
