"""
===============================================================================
EVALUATION TESTING INSTRUCTIONS
===============================================================================
Follow these exact steps to run the local grading server and evaluate your AI results:

STEP 1: START THE DOCKER GRADING SERVER
---------------------------------------
1. Open a new terminal window.
2. Navigate to the folder containing the hackathon's provided Docker files (sdoc-hackathon-docker) 
   (where the docker-compose.yml is located).
3. Start the evaluation server by running:
   docker compose up --build
4. Wait until the terminal shows the server is listening on port 8080.
5. LEAVE THIS TERMINAL OPEN AND RUNNING in the background.

STEP 2: PREPARE YOUR RESULTS
---------------------------------------
1. Ensure your main cloud pipeline has processed the emails and saved the 
   final output.
2. Verify the output is saved exactly at:
   backend/evaluation/results/result.json

STEP 3: RUN THIS TEST SCRIPT
---------------------------------------
1. Open a SECOND terminal window.
2. Navigate to the evaluation directory inside your backend folder:
   cd backend/evaluation
3. Run this python script:
   python submit_eval.py
4. The script will read your result.json, send it to the Docker server running 
   in the first terminal, and print your final scoreboard results.
===============================================================================
"""

import json
import sys
from pathlib import Path

try:
    import requests
except ImportError as e:
    raise SystemExit(
        "Missing dependency 'requests'. Install it with: pip install requests"
    ) from e

# 1. Dynamically resolve the absolute path to result.json
current_dir = Path(__file__).parent
result_file = current_dir / "results" / "result.json"

def evaluate_submission():
    # 2. Check if the file actually exists before trying to read it
    if not result_file.exists():
        print(f"❌ Error: Could not find {result_file}")
        sys.exit(1)

    print(f"📄 Loading submission from: {result_file}")
    
    # 3. Safely load the JSON
    with open(result_file, "r", encoding="utf-8") as file:
        try:
            submission = json.load(file)
        except json.JSONDecodeError:
            print("❌ Error: result.json is not valid JSON.")
            sys.exit(1)

    print("🚀 Sending payload to Docker grading server (http://localhost:8080/submit)...")
    
    # 4. Execute the POST request with error handling
    try:
        response = requests.post(
            "http://localhost:8080/submit",
            json=submission,
            timeout=10 # Prevents the script from hanging forever if Docker freezes
        )
        
        # 5. Handle standard HTTP errors (e.g., 400 Bad Request, 500 Internal Error)
        response.raise_for_status()
        
        # 6. Print the successful scoreboard response
        print("\n✅ Grading Complete! Scoreboard Results:")
        print(json.dumps(response.json(), indent=2))
        
    except requests.exceptions.ConnectionError:
        print("\n❌ Connection Error: Could not reach the grading server.")
        print("💡 Check: Is the Docker container actually running on localhost:8080?")
    except requests.exceptions.HTTPError as e:
        print(f"\n❌ HTTP Error: {e}")
        print("Server response:", response.text)

if __name__ == "__main__":
    evaluate_submission()