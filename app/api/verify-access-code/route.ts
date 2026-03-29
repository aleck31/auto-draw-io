export async function POST(req: Request) {
    const accessCode = process.env.ACCESS_CODE?.trim()

    if (!accessCode) {
        return Response.json({
            valid: true,
            message: "No access code required",
        })
    }

    const provided = req.headers.get("x-access-code")

    if (!provided || provided !== accessCode) {
        return Response.json(
            { valid: false, message: "Invalid access code" },
            { status: 401 },
        )
    }

    return Response.json({ valid: true, message: "Access code verified" })
}
