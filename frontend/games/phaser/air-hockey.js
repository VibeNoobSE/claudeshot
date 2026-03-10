registerGame("air-hockey", "🏒 Air Hockey", "WASD = P1, Arrows = P2", "First to 7 goals", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a3a4e");
    this.add.rectangle(W/2,H/2,W-40,H-40).setStrokeStyle(2,0x4488aa);
    this.add.circle(W/2,H/2,60).setStrokeStyle(2,0x4488aa);
    this.add.rectangle(W/2,H/2,4,H-40,0x4488aa);
    // Goals
    this.add.rectangle(22,H/2,4,120,0xf7c948);this.add.rectangle(W-22,H/2,4,120,0xe94560);
    this.p1=this.add.circle(120,H/2,22,0xf7c948);this.p2=this.add.circle(W-120,H/2,22,0xe94560);
    this.puck=this.add.circle(W/2,H/2,12,0xffffff);
    [this.p1,this.p2,this.puck].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setBounce(1);});
    [this.p1,this.p2].forEach(p=>p.body.setImmovable(false).setDrag(300).setMaxVelocity(350));
    this.puck.body.setDrag(20).setMaxVelocity(500);
    this.physics.add.collider(this.p1,this.puck);this.physics.add.collider(this.p2,this.puck);
    this.physics.add.collider(this.p1,this.p2);
    this.s1=0;this.s2=0;
    this.scoreTxt=this.add.text(W/2,20,"0 — 0",{fontSize:"28px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
  }
  resetPuck(){this.puck.setPosition(W/2,H/2);this.puck.body.setVelocity(0);}
  update(){
    const s=400,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    this.p1.x=Math.min(this.p1.x,W/2-30);this.p2.x=Math.max(this.p2.x,W/2+30);
    if(this.puck.x<30&&Math.abs(this.puck.y-H/2)<60){this.s2++;this.scoreTxt.setText(this.s1+" — "+this.s2);this.resetPuck();}
    if(this.puck.x>W-30&&Math.abs(this.puck.y-H/2)<60){this.s1++;this.scoreTxt.setText(this.s1+" — "+this.s2);this.resetPuck();}
    if(this.s1>=7||this.s2>=7){this.physics.pause();this.add.text(W/2,H/2,(this.s1>=7?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
