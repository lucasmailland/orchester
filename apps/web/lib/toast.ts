import { toast, type ExternalToast } from "sonner";

export const notify = {
  success: (message: string, opts?: ExternalToast) => toast.success(message, opts),
  error: (message: string, opts?: ExternalToast) => toast.error(message, opts),
  loading: (message: string, opts?: ExternalToast) => toast.loading(message, opts),
  dismiss: (id?: string | number) => toast.dismiss(id),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promise: <T>(promise: Promise<T> | (() => Promise<T>), opts: any) =>
    toast.promise(promise, opts),
};
