import asyncio
import httpx

async def test_backend():
    async with httpx.AsyncClient() as client:
        # Check health
        health = await client.get("http://localhost:8080/healthz")
        print("Health:", health.status_code, health.text)
        
        # Check prepare draft route
        resp = await client.post("http://localhost:8080/api/cases/case-email-520/draft/prepare", json={})
        print("Prepare Draft status:", resp.status_code)
        if resp.status_code == 200:
            data = resp.json()
            print("Case ID:", data.get("case_id"))
            print("Draft subject:", data.get("draft", {}).get("subject"))
            print("Draft state:", data.get("draft", {}).get("state"))
        else:
            print("Error:", resp.text)

if __name__ == "__main__":
    asyncio.run(test_backend())
