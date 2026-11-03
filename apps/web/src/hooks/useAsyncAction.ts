// reusable hook to handle async actions in a cleaner way with statuses, errors, etc.

import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<TData, TError> {
    data: TData | null;
    error: TError | null;
    status: 'idle' | 'pending' | 'success' | 'error'
    isIdle: boolean;
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean
}

interface UseAsyncStateOptions<TData, TError, TVariables> {
    triggerFn: (variables: TVariables) => Promise<TData>
    onSuccess?: (data: TData, variables: TVariables) => void | Promise<unknown>
    onError?: (error: TError, variables: TVariables) => void | Promise<unknown>
    onSettled?: (data: TData | null, error: TError | null, variables: TVariables) => void | Promise<unknown>
}


export function useAsyncAction<TData = unknown, TError = Error, TVariables = void>({ triggerFn, onSuccess, onError, onSettled }: UseAsyncStateOptions<TData, TError, TVariables>) {
    const [state, setState] = useState<AsyncState<TData, TError>>({
        data: null,
        error: null,
        isError: false,
        isIdle: true,
        isPending: false,
        isSuccess: false,
        status: 'idle',
    })

    const optionsRef = useRef({ triggerFn, onSuccess, onError, onSettled })
    optionsRef.current = { triggerFn, onSuccess, onError, onSettled };

    const latestTriggerId = useRef(0)


    const triggerAsync = useCallback(async (variables: TVariables) => {
        const currentTriggerId = ++latestTriggerId.current
        const { triggerFn: fn, onSuccess: successFn, onError: errFn, onSettled: settledFn } = optionsRef.current


        setState({
            data: null,
            error: null,
            isError: false,
            isIdle: false,
            isPending: true,
            isSuccess: false,
            status: 'pending',
        })


        try {
            const res = await fn(variables)
            if (currentTriggerId === latestTriggerId.current) {
                setState({
                    data: res,
                    error: null,
                    isError: false,
                    isIdle: false,
                    isPending: false,
                    isSuccess: true,
                    status: 'success',
                })
                if (successFn) {
                    await successFn(res, variables)
                }
                if (settledFn) await settledFn(res, null, variables)
            }
            return res
        } catch (e) {
            const typedErr = e as TError

            if (currentTriggerId === latestTriggerId.current) {
                setState({
                    data: null,
                    error: typedErr,
                    isError: true,
                    isIdle: false,
                    isPending: false,
                    isSuccess: false,
                    status: 'error',
                })
                if (errFn) {
                    await errFn(typedErr, variables)
                }
                if (settledFn) {
                    await settledFn(null, typedErr, variables)
                }
                throw e
            }

        }
    }, [])

    const trigger = useCallback((variables: TVariables) => {
        triggerAsync(variables).catch(() => { })
    }, [triggerAsync])

    return {
        ...state, trigger, triggerAsync
    }
}