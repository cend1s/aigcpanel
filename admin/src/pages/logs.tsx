import { List } from "@refinedev/antd";
import { Table, Tag, Typography } from "antd";
import { TASK_STATUS, time } from "../format";
import { SearchBar, useAdminTable } from "./common";

export const TaskList = () => {
    const { tableProps, searchFormProps } = useAdminTable("task");
    return (
        <List>
            <SearchBar
                formProps={searchFormProps}
                placeholder="用户邮箱或模型名"
                statusOptions={Object.entries(TASK_STATUS).map(([value, s]) => ({ value, label: s.text }))}
            />
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "任务 ID", dataIndex: "id", render: (v) => <Typography.Text copyable={{ text: v }}>{String(v).slice(0, 8)}</Typography.Text> },
                    { title: "用户", dataIndex: "email" },
                    { title: "模型", dataIndex: "model" },
                    { title: "状态", dataIndex: "status", render: (s) => <Tag color={TASK_STATUS[s]?.color}>{TASK_STATUS[s]?.text ?? s}</Tag> },
                    { title: "预扣", dataIndex: "reserved" },
                    { title: "实扣", dataIndex: "settled" },
                    { title: "错误", dataIndex: "error", ellipsis: true },
                    { title: "创建时间", dataIndex: "createdAt", render: time },
                ]}
            />
        </List>
    );
};

const ACTIONS: Record<string, string> = {
    adjust_quota: "调整额度",
    set_status: "启用/禁用用户",
    create_redemption: "生成兑换码",
    save_plan: "保存套餐",
    save_model: "保存模型",
    complete_order: "人工补单",
};

export const AuditList = () => {
    const { tableProps, searchFormProps } = useAdminTable("audit");
    return (
        <List>
            <SearchBar formProps={searchFormProps} placeholder="操作或对象" />
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "时间", dataIndex: "createdAt", render: time, width: 180 },
                    { title: "操作人", dataIndex: "actor" },
                    { title: "操作", dataIndex: "action", render: (a) => ACTIONS[a] ?? a },
                    { title: "对象", dataIndex: "target" },
                    { title: "详情", dataIndex: "detail", ellipsis: true, render: (d) => <code>{d}</code> },
                ]}
            />
        </List>
    );
};
