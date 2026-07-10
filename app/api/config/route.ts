import { NextResponse } from "next/server"
import { getServerModels } from "@/lib/ai-providers"

export async function GET() {
    return NextResponse.json({
        accessCodeRequired: !!process.env.ACCESS_CODE,
        dailyRequestLimit: Number(process.env.DAILY_REQUEST_LIMIT) || 0,
        dailyTokenLimit: Number(process.env.DAILY_TOKEN_LIMIT) || 0,
        tpmLimit: Number(process.env.TPM_LIMIT) || 0,
        serverModels: getServerModels(),
    })
}
