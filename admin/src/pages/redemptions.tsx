import { List } from "@refinedev/antd";
import { Button, DatePicker, Form, Input, InputNumber, Modal, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";
import { time } from "../format";
import { SearchBar, useAction, useAdminTable } from "./common";

export const RedemptionList = () => {
    const { tableProps, searchFormProps, tableQuery } = useAdminTable("redemption");
    const act = useAction();
    const [open, setOpen] = useState(false);
    const [keys, setKeys] = useState<string[]>([]);
    const [form] = Form.useForm();

    const submit = async () => {
        const v = await form.validateFields();
        const expired = v.expiredAt as Dayjs | undefined;
        const r = await act(
            "admin/redemption/create",
            { count: v.count, quota: v.quota, batch: v.batch, expiredTime: expired ? expired.endOf("day").unix() : 0 },
            "已生成",
            tableQuery.refetch,
        );
        if (r) {
            setOpen(false);
            setKeys(r.keys);
        }
    };

    return (
        <List headerButtons={<Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>批量生成</Button>}>
            <SearchBar
                formProps={searchFormProps}
                placeholder="批次或完整兑换码"
                statusOptions={[{ value: "1", label: "未使用" }, { value: "2", label: "已使用" }]}
            />
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "兑换码", dataIndex: "key", render: (k) => <Typography.Text copyable code>{k}</Typography.Text> },
                    { title: "额度", dataIndex: "quota" },
                    { title: "批次", dataIndex: "batch" },
                    { title: "状态", dataIndex: "status", render: (s) => (s === 1 ? <Tag color="green">未使用</Tag> : <Tag>已使用</Tag>) },
                    { title: "使用者 ID", dataIndex: "used_user_id", render: (v) => v || "-" },
                    { title: "过期时间", dataIndex: "expired_time", render: (v) => (v ? time(v) : "永不过期") },
                    { title: "创建时间", dataIndex: "created_at", render: time },
                ]}
            />
            <Modal title="批量生成兑换码" open={open} onOk={submit} onCancel={() => setOpen(false)} destroyOnClose>
                <Form form={form} layout="vertical" initialValues={{ count: 10 }}>
                    <Form.Item name="count" label="数量（1-1000）" rules={[{ required: true }]}>
                        <InputNumber min={1} max={1000} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="quota" label="每个兑换码的额度" rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="batch" label="批次名称（便于查找）">
                        <Input maxLength={50} />
                    </Form.Item>
                    <Form.Item name="expiredAt" label="过期日期（不填则永不过期）">
                        <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal title={`已生成 ${keys.length} 个兑换码`} open={keys.length > 0} footer={null} onCancel={() => setKeys([])}>
                <Typography.Paragraph type="secondary">请立即复制保存，之后也可以在列表中查看。</Typography.Paragraph>
                <Typography.Paragraph copyable={{ text: keys.join("\n") }}>
                    <pre style={{ maxHeight: 300, overflow: "auto" }}>{keys.join("\n")}</pre>
                </Typography.Paragraph>
            </Modal>
        </List>
    );
};
