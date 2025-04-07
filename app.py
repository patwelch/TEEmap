# app.py
# Import the Flask framework
from flask import Flask, render_template

# Create a Flask application instance
app = Flask(__name__)

# Define the main route that renders the map page
@app.route('/')
def index():
    """
    Renders the main map page (index.html).
    """
    # The actual map logic is handled by JavaScript in the HTML file
    return render_template('index.html')

# Run the Flask application
if __name__ == '__main__':
    # Set debug=True for development (shows errors in browser)
    # In production, use a proper WSGI server instead of the development server
    app.run(debug=True)
