import wikipedia
import traceback

wikipedia.set_user_agent("AgenticAIAssignmentBot/1.0 (mailto:test@example.com)")

print("\nTesting Wikipedia with User-Agent...")
try:
    search_results = wikipedia.search("Apple AAPL earnings", results=3)
    print("Wikipedia search results:", search_results)
    if search_results:
        page = wikipedia.page(search_results[0], auto_suggest=False)
        print("Wikipedia page title:", page.title)
except Exception as e:
    print("Wikipedia failed:")
    traceback.print_exc()
