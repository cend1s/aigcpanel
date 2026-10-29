import type { AuthProvider, CrudFilter, DataProvider } from "@refinedev/core";
import { api, ApiError, tokenStore } from "./api";
import { formToModel, modelToForm } from "./pages/modelForm";

// ── 资源字段转换：后端存“分”和 JSON 对象，表单里用“元”和 JSON 文本 ─────────────
const json = (v: unknown) => JSON.stringify(v ?? {}, null, 2);
const parseJson = (s: unknown, field: string) => {
    if (typeof s !== "string" || !s.trim()) return {};
    try {
        return JSON.parse(s);
    } catch {
        throw new ApiError(`${field} 不是合法的 JSON`, 400);
    }
};

const mapIn: Record<string, (r: any) => any> = {
    plan: (r) => ({ ...r, priceYuan: r.priceCents / 100, functionsJson: json(r.functions) }),
    model: (r) => ({ id: r.id, ...modelToForm(r) }),
};
const mapOut: Record<string, (v: any) => any> = {
    plan: ({ priceYuan, functionsJson, ...v }) => ({
        ...v,
        priceCents: Math.round(Number(priceYuan) * 100),
        functions: parseJson(functionsJson, "功能权限"),
    }),
    model: ({ id, ...v }) => ({ ...(id ? { id } : {}), ...formToModel(v) }),
};
const inOf = (resource: string) => mapIn[resource] ?? ((r: any) => r);
// 列表直接展示后端原始字段；模型的表单拆分只用于编辑页
const listInOf = (resource: string) => (resource === "model" ? (r: any) => r : inOf(resource));
const outOf = (resource: string) => mapOut[resource] ?? ((v: any) => v);

const filtersToBody = (filters?: CrudFilter[]) =>
    Object.fromEntries(
        (filters ?? [])
            .filter((f): f is CrudFilter & { field: string } => "field" in f && f.value !== undefined && f.value !== "")
            .map((f) => [f.field, f.value]),
    );

// Refine 的增删改查 → 后端 /api/admin/{resource}/list|get|save
export const dataProvider: DataProvider = {
    getApiUrl: () => "/api/admin",
    getList: async ({ resource, pagination, filters }) => {
        const r = await api<{ records: any[]; total: number }>(`admin/${resource}/list`, {
            page: pagination?.currentPage ?? 1,
            pageSize: pagination?.pageSize ?? 20,
            ...filtersToBody(filters),
        });
        return { data: r.records.map(listInOf(resource)), total: r.total };
    },
    getOne: async ({ resource, id }) => ({ data: inOf(resource)(await api(`admin/${resource}/get`, { id })) }),
    create: async ({ resource, variables }) => ({ data: (await api(`admin/${resource}/save`, outOf(resource)(variables))) as any }),
    update: async ({ resource, id, variables }) => ({
        data: (await api(`admin/${resource}/save`, { ...outOf(resource)(variables), id })) as any,
    }),
    deleteOne: async () => {
        // 有财务含义的数据不提供删除（套餐、模型用“停用”代替）
        throw new ApiError("不支持删除", 400);
    },
    custom: async ({ url, payload }) => ({ data: (await api(url, payload ?? {})) as any }),
};

export type AdminIdentity = { id: number; email: string; nickname: string };

export const authProvider: AuthProvider = {
    login: async ({ email, password, captchaId, captchaCode }) => {
        try {
            const r = await api<{ apiToken: string }>("auth/login", { email, password, captchaId, captchaCode });
            tokenStore.set(r.apiToken);
            await api("admin/me"); // 非管理员会得到 403
            return { success: true, redirectTo: "/" };
        } catch (e) {
            tokenStore.clear();
            const msg = e instanceof ApiError && e.statusCode === 403 ? "该账号不是管理员" : (e as Error).message;
            // Refine 会用 error 弹出通知；是否需要图形验证码单独放在 captchaRequired 里给登录页用
            return {
                success: false,
                error: { name: "登录失败", message: msg },
                captchaRequired: e instanceof ApiError && e.type === "CaptchaRequired",
            };
        }
    },
    logout: async () => {
        await api("auth/logout").catch(() => undefined);
        tokenStore.clear();
        return { success: true, redirectTo: "/login" };
    },
    check: async () => {
        if (!tokenStore.get()) return { authenticated: false, redirectTo: "/login" };
        try {
            await api("admin/me");
            return { authenticated: true };
        } catch {
            tokenStore.clear();
            return { authenticated: false, redirectTo: "/login", logout: true };
        }
    },
    onError: async (error) => {
        if (error?.statusCode === 401 || error?.statusCode === 403) {
            return { logout: true, redirectTo: "/login", error };
        }
        return { error };
    },
    getIdentity: async () => {
        const me = await api<AdminIdentity>("admin/me");
        return { ...me, name: me.nickname || me.email };
    },
};
