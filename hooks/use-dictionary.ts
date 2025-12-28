"use client"

import React, { createContext, useContext } from "react"
import { type Dictionary, dictionary } from "@/lib/dictionary"

const DictionaryContext = createContext<Dictionary>(dictionary)

export function DictionaryProvider({ children }: React.PropsWithChildren) {
    return React.createElement(
        DictionaryContext.Provider,
        { value: dictionary },
        children,
    )
}

export function useDictionary() {
    return useContext(DictionaryContext)
}

export default useDictionary
