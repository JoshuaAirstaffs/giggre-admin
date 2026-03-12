"use client"

export default function TitlePage({ title }: { title: string }) {
    return (
        <div>
            <div className="text-2xl font-bold">{title}</div>
        </div>
    )
}